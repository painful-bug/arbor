// Research-plan tool: records the agent's sub-topic plan so the UI can show it.
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";

const planSchema = Type.Object({
	topics: Type.Array(Type.String(), {
		description: "3–6 concrete sub-topics / search angles to investigate.",
	}),
	rationale: Type.Optional(Type.String({ description: "One line on the overall strategy." })),
});

/** Research-plan AgentTool — pure echo; the plan is surfaced via the SSE timeline. */
export function researchPlanTool(): AgentTool<typeof planSchema> {
	return {
		name: "research_plan",
		label: "research_plan",
		description:
			"Record your research plan BEFORE searching. Pass the sub-topics you will investigate. Call this first in deep research so the plan is shown to the user.",
		parameters: planSchema,
		async execute(_id, params): Promise<AgentToolResult<{ topics: string[] }>> {
			const text = `Plan:\n${params.topics.map((t, i) => `${i + 1}. ${t}`).join("\n")}`;
			return { content: [{ type: "text", text }], details: { topics: params.topics } };
		},
	};
}
