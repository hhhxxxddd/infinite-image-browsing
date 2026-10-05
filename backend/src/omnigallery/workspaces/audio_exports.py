"""Audio adapter for durable, cancellable background exports."""

import math
from contextlib import nullcontext
from uuid import UUID

from fastapi import Depends, HTTPException

from omnigallery.infrastructure.database import Database
from omnigallery.workspaces.audio_studio import (
    AudioExport,
    assert_saved_audio_document,
    commit_audio,
    probe_source,
    render_audio,
    resolve_source,
)
from omnigallery.workspaces.media_export_queue import MediaExportQueue
from omnigallery.workspaces.media_export_runtime import run_media_process


class AudioExportSubmission(AudioExport):
    task_id: UUID


class AudioExportAdapter:
    kind = "audio"
    request = AudioExport

    def __init__(self, check_path_trust, renderer=render_audio, publisher=commit_audio):
        self.check_path_trust, self.renderer, self.publish = check_path_trust, renderer, publisher

    def validate(self, conn, request, *, current_revision=True):
        assert_saved_audio_document(conn, request, current_revision=current_revision)
        if request.start + request.duration > 86400:
            raise HTTPException(422, "导出范围超出 24 小时时间线")

    def sources(self, request):
        sources = {}
        for track in request.document.tracks:
            for clip in track.clips:
                source = resolve_source(clip.path, request.workspace_id, self.check_path_trust)
                metadata = probe_source(source, clip.audioStream)
                if clip.sourceIn + clip.duration * clip.rate > metadata["duration"] + 0.03:
                    raise HTTPException(422, f"片段超出源音频范围：{clip.name}")
                stat = source.stat()
                sources[clip.path] = [str(source.resolve()), stat.st_size, stat.st_mtime_ns]
        return sources

    @staticmethod
    def disk_bytes(request):
        from omnigallery.workspaces.audio_mix_render import needs_full_mix, sound_duration

        length = (
            sound_duration("audio", request.document)
            if needs_full_mix("audio", request.document)
            else request.duration
        )
        # One sidechain, two working mix files, and the track being processed; the final
        # encoded selection may coexist with the finalized full normalization mix.
        return math.ceil((length * 4 + request.duration) * 48000 * 8) + 256 * 1024**2

    def render(self, request, stage, checkpoint, progress):
        from omnigallery.workspaces.audio_mix_render import (
            needs_full_mix,
            render_operations,
            sound_document,
            sound_duration,
        )

        output = stage / ("mix." + request.format)
        complete = needs_full_mix("audio", request.document)
        lease = nullcontext(None)
        if complete:
            from omnigallery.workspaces.audio_mix_cache import get_audio_mix_cache_manager

            lease = get_audio_mix_cache_manager().lease_ready(
                request.workspace_id, "audio", request.document
            )
        with lease as cached:
            operations = (
                1
                if cached
                else render_operations(
                    sound_document("audio", request.document),
                    0 if complete else request.start,
                    sound_duration("audio", request.document) if complete else request.duration,
                )
                + 1
            )
            finished, reported = 0, 0

            def run(args, directory, duration):
                nonlocal finished, reported

                def report(value):
                    nonlocal reported
                    reported = max(reported, min(99, (finished + value / 100) / operations * 99))
                    progress(reported)

                result = run_media_process(args, directory, duration, checkpoint, report)
                finished += 1
                report(0)
                return result

            options = {"check_cancel": checkpoint} if self.renderer is render_audio else {}
            self.renderer(
                request, output, self.check_path_trust, request.format, runner=run, **options
            )
            progress(99)
        return output


class AudioExports(MediaExportQueue):
    def __init__(
        self, connection, check_path_trust, *, renderer=render_audio, publisher=commit_audio
    ):
        super().__init__(connection, AudioExportAdapter(check_path_trust, renderer, publisher))


def mount_audio_export_routes(
    app, base, verify_secret, write_permission_required, check_path_trust
):
    manager = AudioExports(Database.get_connection, check_path_trust)
    app.state.audio_exports = manager
    route = base + "/audio_studio/tasks"

    @app.get(route, dependencies=[Depends(verify_secret)])
    def list_tasks(workspace_id: str, document_id: str = ""):
        return manager.list(workspace_id, document_id)

    @app.post(
        route,
        status_code=202,
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def submit(request: AudioExportSubmission):
        return manager.submit(request)

    @app.post(
        route + "/{task_id}/cancel",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def cancel(task_id: UUID, workspace_id: str):
        return manager.cancel(workspace_id, str(task_id))
