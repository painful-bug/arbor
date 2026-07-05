// Transient in-app note notifications. When a note is created from a file selection
// we surface it here (collapsed → click to expand + scroll) instead of only dropping
// a card on the canvas. Untouched notifications auto-dismiss after NOTIF_DISMISS_TIME;
// the per-item timer + interaction guard live in NoteNotifications.svelte.

export const NOTIF_DISMISS_TIME = 3000; // ms — auto-dismiss if the user doesn't interact

export interface NoteNotif {
	id: number;
	title: string;
	body: string;
}

export const noteNotifs = $state<NoteNotif[]>([]);
let seq = 0;

export function notifyNote(body: string): number {
	const id = ++seq;
	const title =
		body
			.split("\n")
			.find((l) => l.trim())
			?.slice(0, 80) || "Note created";
	noteNotifs.push({ id, title, body });
	return id;
}

export function dismissNote(id: number): void {
	const i = noteNotifs.findIndex((n) => n.id === id);
	if (i !== -1) noteNotifs.splice(i, 1);
}
