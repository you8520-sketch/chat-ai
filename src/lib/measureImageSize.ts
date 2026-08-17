export type MeasuredImageSize = { width: number; height: number };

export function measureImageUrl(url: string): Promise<MeasuredImageSize | null> {
  if (!url || typeof Image === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      resolve(width > 0 && height > 0 ? { width, height } : null);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function measureImageFile(file: File): Promise<MeasuredImageSize | null> {
  if (typeof URL === "undefined") return Promise.resolve(null);
  const objectUrl = URL.createObjectURL(file);
  return measureImageUrl(objectUrl).finally(() => {
    URL.revokeObjectURL(objectUrl);
  });
}
