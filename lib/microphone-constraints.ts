type VoiceIsolationConstraints = MediaTrackConstraints & {
  voiceIsolation?: boolean;
};

export function microphoneConstraintAttempts(
  deviceId?: string,
  supportsVoiceIsolation = false,
): MediaStreamConstraints[] {
  const selectedDevice = deviceId ? { deviceId: { exact: deviceId } } : {};
  const enhanced: VoiceIsolationConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    // Sensitive Mac microphones can amplify keyboard and clothing noise when
    // AGC raises quiet input. Speech remains at its natural input level.
    autoGainControl: false,
    channelCount: 1,
    ...(supportsVoiceIsolation ? { voiceIsolation: true } : {}),
    ...selectedDevice,
  };

  return [
    { audio: enhanced, video: false },
    {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
        ...selectedDevice,
      },
      video: false,
    },
    { audio: deviceId ? selectedDevice : true, video: false },
  ];
}
