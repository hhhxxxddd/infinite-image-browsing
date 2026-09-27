def get_frame_at_second(video_path, second):
    import av

    with av.open(video_path) as container:
        time_base = container.streams.video[0].time_base
        frame_container_pts = round(second / time_base)

        container.seek(frame_container_pts, backward=True, stream=container.streams.video[0])
        frame = next(container.decode(video=0))
        return frame
