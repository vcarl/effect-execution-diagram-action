import type { GitHub } from "@actions/github/lib/utils.js";

type Octokit = InstanceType<typeof GitHub>;

const COMMENT_MARKER = "<!-- effect-flow-diagram -->";

export async function upsertComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
): Promise<void> {
  const markedBody = `${COMMENT_MARKER}\n${body}`;

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: markedBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: markedBody,
    });
  }
}

export function formatComment(sections: DiagramSection[]): string {
  const lines = ["## Effect-TS Flow Diagrams\n"];

  for (const section of sections) {
    lines.push(`<details><summary>${section.title}</summary>\n`);
    lines.push("```mermaid");
    lines.push(section.mermaid);
    lines.push("```\n");
    if (section.truncated) {
      lines.push(
        `> Diagram truncated: showing ${section.shownNodes} of ${section.totalNodes} nodes.\n`
      );
    }
    lines.push("</details>\n");
  }

  return lines.join("\n");
}

export interface DiagramSection {
  title: string;
  mermaid: string;
  truncated?: boolean;
  shownNodes?: number;
  totalNodes?: number;
}
