import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PICKER_TIMEOUT_MS = 5 * 60_000;

export interface HostFilePicker {
  pick(): Promise<string | null>;
}

export class NativeHostFilePicker implements HostFilePicker {
  private activePick: Promise<string | null> | null = null;

  async pick() {
    if (this.activePick) throw new Error("A file picker is already open");
    this.activePick = this.pickForPlatform();
    try { return await this.activePick; }
    finally { this.activePick = null; }
  }

  private pickForPlatform() {
    if (process.platform === "win32") return pickOnWindows();
    if (process.platform === "darwin") return pickOnMacOS();
    return Promise.reject(new Error("Native file selection is supported on Windows and macOS"));
  }
}

async function pickOnWindows() {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    "$dialog.Title = 'Choose a movie for WatchTogether'",
    "$dialog.Filter = 'Browser video (*.mp4;*.m4v;*.webm)|*.mp4;*.m4v;*.webm|Other video (*.mkv;*.avi;*.mov)|*.mkv;*.avi;*.mov|All files (*.*)|*.*'",
    "$dialog.Multiselect = $false",
    "$dialog.CheckFileExists = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
    "  [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($dialog.FileName))",
    "}",
  ].join("\r\n");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-STA", "-Command", script], {
    encoding: "utf8", timeout: PICKER_TIMEOUT_MS, windowsHide: true, maxBuffer: 16_384,
  });
  const encodedPath = stdout.trim();
  if (!encodedPath) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encodedPath)) throw new Error("File picker returned invalid output");
  return Buffer.from(encodedPath, "base64").toString("utf8");
}

async function pickOnMacOS() {
  try {
    const { stdout } = await execFileAsync("osascript", [
      "-e", "set selectedFile to choose file with prompt \"Choose a movie for WatchTogether\"",
      "-e", "POSIX path of selectedFile",
    ], { encoding: "utf8", timeout: PICKER_TIMEOUT_MS, maxBuffer: 16_384 });
    return stdout.trim() || null;
  } catch (error) {
    const stderr = typeof error === "object" && error && "stderr" in error ? String(error.stderr) : "";
    if (stderr.includes("-128") || stderr.toLowerCase().includes("user canceled")) return null;
    throw error;
  }
}
