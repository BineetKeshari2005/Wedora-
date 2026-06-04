// Stub for future multi-clip transition support (xfade)
export const buildTransitionFilter = (transitionType: string, inputA: string, inputB: string, filterIndex: number): { filterStr: string; nextLabel: string } | null => {
  // Since we only have 1 input video for now, transitions are placeholders.
  // In a multi-clip scenario, we would use `xfade` filter.
  return null;
};
