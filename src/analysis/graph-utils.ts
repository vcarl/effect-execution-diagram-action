/** Split a graph into connected components via BFS. */
export function splitConnectedComponents<
  N extends { id: string },
  E extends { from: string; to: string }
>(graph: { nodes: N[]; edges: E[] }): { nodes: N[]; edges: E[] }[] {
  const adjMap = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adjMap.set(node.id, new Set());
  }
  for (const edge of graph.edges) {
    adjMap.get(edge.from)?.add(edge.to);
    adjMap.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<string>();
  const components: { nodes: N[]; edges: E[] }[] = [];

  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    const componentIds = new Set<string>();
    const queue = [node.id];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      componentIds.add(id);
      for (const neighbor of adjMap.get(id) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push({
      nodes: graph.nodes.filter((n) => componentIds.has(n.id)),
      edges: graph.edges.filter((e) => componentIds.has(e.from)),
    });
  }

  return components;
}
