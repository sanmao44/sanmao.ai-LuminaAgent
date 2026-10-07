export function workspaceTopbarModes(section: string) {
  return {
    imageActive: section === 'generate' || section === 'angle',
    videoActive: section === 'video',
    agentActive: section === 'agent',
  };
}
