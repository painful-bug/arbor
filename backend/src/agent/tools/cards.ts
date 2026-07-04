// Canvas card tools. execute() is a no-op confirmation to the LLM; the real
// mutation happens frontend-side off the tool_start args (args flow via SSE to
// the store).
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

const createNoteSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Short title for the note." })),
	content: Type.String({ description: "The COMPLETE markdown content to save in the note." }),
});

/** create_note AgentTool — standalone markdown note card (no chat history). */
export function createNoteTool(): AgentTool<typeof createNoteSchema> {
	return {
		name: "create_note",
		label: "create_note",
		description:
			"Create a standalone markdown note card on the canvas. Use for saving drafted prose, summaries, emails, outlines, or any authored content the user wants to keep. Unlike create_card (a Q&A thread), notes are pure editable text with no conversation history.",
		parameters: createNoteSchema,
		async execute(_id, params): Promise<AgentToolResult<{ title?: string; content: string }>> {
			return {
				content: [
					{ type: "text", text: `Note "${params.title ?? "Untitled"}" created on the canvas.` },
				],
				details: { title: params.title, content: params.content },
			};
		},
	};
}

const createCardSchema = Type.Object({
	title: Type.String({ description: "Short title — the question or topic this card captures." }),
	content: Type.String({
		description: "The COMPLETE answer in markdown to save into the new card body.",
	}),
});

/** create_card AgentTool — new Q&A card on the canvas. */
export function createCardTool(): AgentTool<typeof createCardSchema> {
	return {
		name: "create_card",
		label: "create_card",
		description:
			"Create a new Q&A card on the canvas. Call this when the user asks to 'save as a card', 'create a card', 'add a card', or 'save the answer'. Pass the topic as title and the full markdown response as content. The card appears immediately on the canvas.",
		parameters: createCardSchema,
		async execute(_id, params): Promise<AgentToolResult<{ title: string; content: string }>> {
			return {
				content: [{ type: "text", text: `Card "${params.title}" created on the canvas.` }],
				details: { title: params.title, content: params.content },
			};
		},
	};
}

const updateCardSchema = Type.Object({
	card: Type.String({
		description:
			"The card id (e.g. n3) from the canvas threads list, or the card's title. Prefer id when available.",
	}),
	content: Type.String({
		description: "New markdown content — fully replaces the card's current body.",
	}),
});

/** update_card AgentTool — replaces an existing card's content. */
export function updateCardTool(): AgentTool<typeof updateCardSchema> {
	return {
		name: "update_card",
		label: "update_card",
		description:
			"Replace the content of an existing canvas card. Use the card id (e.g. n3) from the '## Other threads on this canvas' list when available, otherwise match by title. Call when the user says 'update', 'edit', 'change', or 'modify' a card.",
		parameters: updateCardSchema,
		async execute(_id, params): Promise<AgentToolResult<{ card: string; content: string }>> {
			return {
				content: [{ type: "text", text: `Card "${params.card}" updated.` }],
				details: { card: params.card, content: params.content },
			};
		},
	};
}
