// In-app auto-update via the Tauri updater plugin. Reads latest.json from the
// GitHub "latest release", compares semver against the running app, and (on user
// action) downloads + installs the signed artifact, then relaunches.
//
// `updateState` is the single source of truth for both the Settings → Updates
// pane and the sidebar gear badge. It naturally clears after a successful update:
// the next `check()` returns null, so `status` goes back to 'idle'.

import type { Update } from '@tauri-apps/plugin-updater';

export const updateState = $state<{
	status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
	version: string | null;
	notes: string | null;
	progress: number; // 0..1
	error: string | null;
}>({ status: 'idle', version: null, notes: null, progress: 0, error: null });

// The pending update handle from the last successful check(), kept so the pane's
// Update button (and the macOS notification action) can install without re-checking.
let pending: Update | null = null;

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** True when an update is in-flight or waiting — drives the gear badge. */
export function hasUpdate(): boolean {
	return (
		updateState.status === 'available' ||
		updateState.status === 'downloading' ||
		updateState.status === 'ready'
	);
}

export async function checkForUpdates(notify = false): Promise<void> {
	if (!isTauri()) return; // browser dev: no updater
	if (updateState.status === 'downloading' || updateState.status === 'ready') return;

	updateState.status = 'checking';
	updateState.error = null;
	try {
		const { check } = await import('@tauri-apps/plugin-updater');
		const update = await check();
		if (update) {
			pending = update;
			updateState.status = 'available';
			updateState.version = update.version;
			updateState.notes = update.body ?? null;
			if (notify) await fireUpdateNotification(update.version);
		} else {
			pending = null;
			updateState.status = 'idle';
			updateState.version = null;
			updateState.notes = null;
		}
	} catch (e) {
		// Background checks (startup + interval, notify=true) fail silently —
		// e.g. no release has published a manifest yet, or a transient network
		// blip. Surfacing that as a red error on every app launch is misleading
		// when nothing the user did is actually broken. Only an explicit,
		// user-clicked "Check for updates" (notify=false) shows the failure.
		if (notify) {
			console.warn('[updates] background check failed:', e);
			updateState.status = 'idle';
		} else {
			updateState.status = 'error';
			updateState.error = e instanceof Error ? e.message : String(e);
		}
	}
}

export async function installUpdate(): Promise<void> {
	if (!pending) {
		// No handle (e.g. badge clicked after a cold start) — re-check, then retry.
		await checkForUpdates(false);
		if (!pending) return;
	}
	updateState.status = 'downloading';
	updateState.progress = 0;
	updateState.error = null;
	try {
		let downloaded = 0;
		let total = 0;
		await pending.downloadAndInstall((e) => {
			switch (e.event) {
				case 'Started':
					total = e.data.contentLength ?? 0;
					break;
				case 'Progress':
					downloaded += e.data.chunkLength;
					updateState.progress = total > 0 ? downloaded / total : 0;
					break;
				case 'Finished':
					updateState.progress = 1;
					updateState.status = 'ready';
					break;
			}
		});
		// On Windows the installer auto-quits the app before install; relaunch covers macOS.
		const { relaunch } = await import('@tauri-apps/plugin-process');
		await relaunch();
	} catch (e) {
		updateState.status = 'error';
		updateState.error = e instanceof Error ? e.message : String(e);
	}
}

// ── Native notification ────────────────────────────────────────────────────
// macOS gets an "Update" action button (installs immediately); Windows gets a
// plain notification (its action-button support is unreliable). The body click
// opens the Updates pane on both — wired via registerOnAction() at startup.

let actionsRegistered = false;

async function fireUpdateNotification(version: string): Promise<void> {
	if (!isTauri()) return;
	try {
		const notif = await import('@tauri-apps/plugin-notification');
		if (!(await notif.isPermissionGranted())) {
			if ((await notif.requestPermission()) !== 'granted') return;
		}

		const { platform } = await import('@tauri-apps/plugin-os');
		if (platform() === 'macos') {
			if (!actionsRegistered) {
				await notif.registerActionTypes([
					{ id: 'arbor-update', actions: [{ id: 'update', title: 'Update' }] }
				]);
				actionsRegistered = true;
			}
			await notif.sendNotification({
				title: 'Update available',
				body: `Version ${version}`,
				actionTypeId: 'arbor-update'
			});
		} else {
			await notif.sendNotification({ title: 'Update available', body: `Version ${version}` });
		}
	} catch {
		// Notification failure is non-fatal — the gear badge still surfaces the update.
	}
}

/** Register the notification action/click handler once, at app startup. */
export async function registerOnAction(onOpenPane: () => void): Promise<void> {
	if (!isTauri()) return;
	try {
		const notif = await import('@tauri-apps/plugin-notification');
		await notif.onAction((n) => {
			// macOS "Update" button → install immediately. Any other tap → open the pane.
			if ((n as { actionId?: string }).actionId === 'update') {
				void installUpdate();
			} else {
				onOpenPane();
			}
		});
	} catch {
		// onAction unsupported/failed — the gear badge remains the guaranteed entry point.
	}
}
