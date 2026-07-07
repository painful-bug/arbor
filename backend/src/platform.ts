// Single seam for OS branching in the backend. Never inline `process.platform`,
// a `/opt/homebrew`-style path, or a raw `":"`/`";"` PATH-join elsewhere —
// import from here so macOS and Windows behavior stay isolated in one place.
export const isMac = process.platform === "darwin";
export const isWindows = process.platform === "win32";
export const isLinux = process.platform === "linux";

/** Executable suffix for spawned binaries. */
export const EXE = isWindows ? ".exe" : "";
/** PATH list separator for the current OS. */
export const PATH_SEP = isWindows ? ";" : ":";

/** Common install locations searched for the `ollama` binary, by OS. */
export function ollamaSearchDirs(): string[] {
	if (isWindows) {
		const dirs = [
			process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Programs\\Ollama` : "",
			process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Ollama` : "",
		];
		return dirs.filter(Boolean);
	}
	// macOS + Linux common install locations.
	return [
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
		process.env.HOME ? `${process.env.HOME}/.local/bin` : "",
	].filter(Boolean);
}

export const ollamaBinName = `ollama${EXE}`;
