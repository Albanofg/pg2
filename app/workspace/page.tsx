import { redirect } from "next/navigation";

/**
 * Bare /workspace has no project — send the inventor to their dashboard to pick
 * one. Real work lives at /workspace/<projectId>/<stage>.
 */
export default function WorkspaceIndex() {
  redirect("/projects");
}
