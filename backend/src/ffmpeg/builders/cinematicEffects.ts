export const buildZoomFilter = (zoomStyle: string, currentInput: string, filterIndex: number): { filterStr: string; nextLabel: string } | null => {
  if (zoomStyle === 'slow' || zoomStyle === 'slow-zoom') {
    const nextLabel = `v${filterIndex}`;
    return {
      filterStr: `[${currentInput}]zoompan=z='min(zoom+0.0015,1.5)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'[${nextLabel}]`,
      nextLabel,
    };
  } else if (zoomStyle === 'fast' || zoomStyle === 'fast-zoom') {
    const nextLabel = `v${filterIndex}`;
    return {
      filterStr: `[${currentInput}]zoompan=z='min(zoom+0.003,2.0)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'[${nextLabel}]`,
      nextLabel,
    };
  }
  return null;
};

export const buildColorGradeFilter = (colorTone: string, currentInput: string, filterIndex: number): { filterStr: string; nextLabel: string } | null => {
  const nextLabel = `v${filterIndex}`;
  if (colorTone === 'luxury') {
    // High contrast, sharp, warm gold tones
    return {
      filterStr: `[${currentInput}]colorbalance=rs=.2:gs=.1:bs=-.1,eq=contrast=1.2:saturation=1.1[${nextLabel}]`,
      nextLabel,
    };
  } else if (colorTone === 'romantic') {
    // Soft contrast, slight pink/beige shift
    return {
      filterStr: `[${currentInput}]colorbalance=rs=.15:bs=.05:gs=.05,eq=contrast=0.9:saturation=0.95[${nextLabel}]`,
      nextLabel,
    };
  } else if (colorTone === 'vibrant') {
    // High saturation, high contrast
    return {
      filterStr: `[${currentInput}]eq=saturation=1.5:contrast=1.15[${nextLabel}]`,
      nextLabel,
    };
  } else if (colorTone === 'warm') {
    return {
      filterStr: `[${currentInput}]colorbalance=rs=.2:gs=.1:bs=-.1[${nextLabel}]`,
      nextLabel,
    };
  } else if (colorTone === 'moody') {
    return {
      filterStr: `[${currentInput}]eq=contrast=1.2:brightness=-0.05:saturation=0.8[${nextLabel}]`,
      nextLabel,
    };
  }
  return null;
};

export const buildGlowFilter = (currentInput: string, filterIndex: number): { filterStr: string; nextLabel: string } => {
  const nextLabel = `v${filterIndex}`;
  return {
    filterStr: `[${currentInput}]unsharp=luma_msize_x=7:luma_msize_y=7:luma_amount=0.5[${nextLabel}]`,
    nextLabel,
  };
};
