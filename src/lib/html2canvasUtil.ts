import html2canvas, { Options } from 'html2canvas';

let colorConverterDiv: HTMLDivElement | null = null;

export function cssColorToRgb(colorStr: string): string {
  if (!colorStr || typeof colorStr !== 'string') return 'rgb(0, 0, 0)';
  if (typeof document === 'undefined') return 'rgb(0, 0, 0)';

  const trimmed = colorStr.trim();
  if (!trimmed) return 'rgb(0, 0, 0)';

  if (!colorConverterDiv && document.body) {
    colorConverterDiv = document.createElement('div');
    colorConverterDiv.style.display = 'none';
    colorConverterDiv.setAttribute('id', 'html2canvas-color-converter');
    document.body.appendChild(colorConverterDiv);
  }

  if (!colorConverterDiv) return 'rgb(0, 0, 0)';

  try {
    colorConverterDiv.style.color = '';
    colorConverterDiv.style.color = trimmed;
    const computed = window.getComputedStyle(colorConverterDiv).color;
    if (
      computed &&
      !computed.includes('oklab') &&
      !computed.includes('oklch') &&
      !computed.includes('color-mix') &&
      !computed.includes('color(') &&
      !computed.includes('lab(') &&
      !computed.includes('lch(')
    ) {
      return computed;
    }
  } catch {
    // fallback
  }
  return 'rgb(0, 0, 0)';
}

export function replaceColorFunctions(cssText: string): string {
  if (!cssText || typeof cssText !== 'string') return cssText;

  const lower = cssText.toLowerCase();
  if (
    !lower.includes('oklab') &&
    !lower.includes('oklch') &&
    !lower.includes('color-mix') &&
    !lower.includes('color(') &&
    !lower.includes('lab(') &&
    !lower.includes('lch(')
  ) {
    return cssText;
  }

  const targets = ['oklab(', 'oklch(', 'color-mix(', 'color(', 'lab(', 'lch('];
  let result = cssText;

  for (const target of targets) {
    let searchStart = 0;
    while (true) {
      const idx = result.toLowerCase().indexOf(target, searchStart);
      if (idx === -1) break;

      let depth = 1;
      let end = idx + target.length;
      while (end < result.length && depth > 0) {
        if (result[end] === '(') depth++;
        else if (result[end] === ')') depth--;
        end++;
      }

      if (depth === 0) {
        const fullExpr = result.substring(idx, end);
        const rgbVal = cssColorToRgb(fullExpr);
        result = result.substring(0, idx) + rgbVal + result.substring(end);
        searchStart = idx + rgbVal.length;
      } else {
        searchStart = idx + target.length;
      }
    }
  }

  return result
    .replace(/in\s+oklab/gi, 'in srgb')
    .replace(/in\s+oklch/gi, 'in srgb')
    .replace(/oklab/gi, 'rgb(0,0,0)')
    .replace(/oklch/gi, 'rgb(0,0,0)')
    .replace(/color-mix/gi, 'rgb(0,0,0)');
}

export async function safeHtml2Canvas(element: HTMLElement, options: Partial<Options> = {}) {
  const userOnClone = options.onclone;

  const mergedOptions: Partial<Options> = {
    scale: 2,
    useCORS: true,
    logging: false,
    allowTaint: true,
    ...options,
    onclone: (clonedDoc: Document, clonedEl: HTMLElement) => {
      try {
        // 1. Sanitize all <style> blocks in cloned doc only (does not touch live document)
        const clonedStyles = clonedDoc.querySelectorAll('style');
        clonedStyles.forEach((styleEl) => {
          if (styleEl.textContent) {
            const lower = styleEl.textContent.toLowerCase();
            if (
              lower.includes('oklab') ||
              lower.includes('oklch') ||
              lower.includes('color-mix') ||
              lower.includes('color(')
            ) {
              styleEl.textContent = replaceColorFunctions(styleEl.textContent);
            }
          }
        });

        // 2. Sanitize inline styles only within target cloned element tree
        const root = clonedEl || clonedDoc.body;
        const targetElements = root ? [root, ...Array.from(root.querySelectorAll('*'))] : [];

        targetElements.forEach((el) => {
          if (el instanceof HTMLElement || el instanceof SVGElement) {
            const styleAttr = el.getAttribute('style');
            if (styleAttr) {
              const lowerAttr = styleAttr.toLowerCase();
              if (
                lowerAttr.includes('oklab') ||
                lowerAttr.includes('oklch') ||
                lowerAttr.includes('color-mix') ||
                lowerAttr.includes('color(')
              ) {
                el.setAttribute('style', replaceColorFunctions(styleAttr));
              }
            }
          }
        });
      } catch (err) {
        console.error('Error in safeHtml2Canvas onclone:', err);
      }

      if (userOnClone) {
        userOnClone(clonedDoc, clonedEl);
      }
    }
  };

  return await html2canvas(element, mergedOptions);
}
