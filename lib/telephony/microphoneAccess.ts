export type MicrophoneAccessResult = {
  deviceCount: number;
  permissionState: PermissionState | "unknown";
};

export class MicrophoneAccessError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MicrophoneAccessError";
  }
}

function messageFor(error: any): MicrophoneAccessError {
  if (error instanceof MicrophoneAccessError) return error;
  const name = String(error?.name || "");
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new MicrophoneAccessError(
      "Microphone permission is blocked. In your browser, click the site-controls icon beside the CoveCRM address, set Microphone to Allow, then reload this page. On Safari, also check Safari > Settings for This Website > Microphone.",
      "permission_denied",
    );
  }
  if (name === "NotFoundError") {
    return new MicrophoneAccessError("No microphone was found. Connect or enable a microphone, then try again.", "not_found");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return new MicrophoneAccessError("Another app is using your microphone. Quit Zoom, Teams, FaceTime, or another calling app, then try again.", "busy");
  }
  return new MicrophoneAccessError("CoveCRM could not access your microphone. Check your browser and computer microphone permissions, then reload and try again.", "unavailable");
}

/**
 * Verifies that the browser can capture audio immediately before a call.
 * The test stream is always stopped: leaving it open can lock the selected mic.
 */
export async function ensureMicrophoneAccess(): Promise<MicrophoneAccessResult> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneAccessError("Microphone access requires a supported browser over a secure connection.", "unsupported");
  }

  let permissionState: PermissionState | "unknown" = "unknown";
  try {
    const permissions = navigator.permissions as any;
    const status = await permissions?.query?.({ name: "microphone" });
    if (status?.state) permissionState = status.state;
    if (status?.state === "denied") throw new MicrophoneAccessError(
      "Microphone permission is blocked. In your browser, click the site-controls icon beside the CoveCRM address, set Microphone to Allow, then reload this page. On Safari, also check Safari > Settings for This Website > Microphone.",
      "permission_denied",
    );
  } catch (error) {
    if (error instanceof MicrophoneAccessError) throw error;
  }

  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") {
      throw new MicrophoneAccessError("Your microphone did not start correctly. Disconnect and reconnect it, then try again.", "not_live");
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return { deviceCount: devices.filter((device) => device.kind === "audioinput").length, permissionState };
  } catch (error) {
    throw messageFor(error);
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

export function microphoneErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CoveCRM could not access your microphone. Reload the page and try again.";
}
