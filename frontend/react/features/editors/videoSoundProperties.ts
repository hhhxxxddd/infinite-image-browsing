import {
  clipEnvelope as audioEnvelope,
  setClipFades,
  type AudioClip
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import type { VideoClip } from './videoStudioModel.ts'

export function videoAudioClip(clip: VideoClip): AudioClip {
  return {
    id: clip.id,
    path: clip.path,
    name: clip.name,
    sourceKind: clip.kind === 'video' ? 'video' : 'audio',
    audioStream: clip.audioStream,
    start: clip.start,
    sourceIn: clip.sourceIn,
    duration: clip.duration,
    rate: clip.rate,
    gain: clip.gain,
    pan: clip.pan,
    gainPoints: clip.gainPoints,
    fadeIn: clip.fadeIn ?? 0,
    fadeOut: clip.fadeOut ?? 0,
    fadeCurve: clip.fadeCurve,
    channels: clip.channels,
    invertPhase: clip.invertPhase,
    envelopeOffset: clip.envelopeOffset ?? 0,
    envelopeDuration: clip.envelopeDuration ?? clip.duration
  }
}
export function videoSoundEnvelope(clip: VideoClip, local: number) {
  return audioEnvelope(videoAudioClip(clip), local)
}
/** Editing fades starts a new envelope but retains automation over the visible interval. */
export function setVideoSoundFades(clip: VideoClip, fadeIn: number, fadeOut: number): VideoClip {
  const changed = setClipFades(videoAudioClip(clip), fadeIn, fadeOut)
  return {
    ...clip,
    fadeIn: changed.fadeIn,
    fadeOut: changed.fadeOut,
    envelopeOffset: changed.envelopeOffset,
    envelopeDuration: changed.envelopeDuration,
    gainPoints: changed.gainPoints
  }
}
/** Apply a direct envelope edit without replacing media, links or timing instructions. */
export function patchVideoSound(clip: VideoClip, sound: AudioClip): VideoClip {
  return {
    ...clip,
    gain: sound.gain,
    pan: sound.pan,
    gainPoints: sound.gainPoints,
    fadeIn: sound.fadeIn,
    fadeOut: sound.fadeOut,
    fadeCurve: sound.fadeCurve,
    channels: sound.channels,
    invertPhase: sound.invertPhase,
    envelopeOffset: sound.envelopeOffset,
    envelopeDuration: sound.envelopeDuration
  }
}
