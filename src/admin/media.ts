const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Select the first image file only. Pasted HTML and remote URLs are never fetched. */
export function imageFromTransfer(data: DataTransfer | null): File | undefined {
  if (!data) return undefined;
  const image = Array.from(data.files ?? []).find(file => file.type.startsWith('image/'));
  if (image) return image;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return undefined;
}

/** Early input feedback. GitHubClient also verifies the final file's magic bytes. */
export function validateImage(file: File): void {
  if (!IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPEG、GIF 和 WebP 图片。');
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('图片必须大于 0 字节且不超过 5 MiB。');
  }
}

function hasFiles(data: DataTransfer | null): boolean {
  return Boolean(data && (data.files?.length
    || Array.from(data.items ?? []).some(item => item.kind === 'file')
    || Array.from(data.types ?? []).includes('Files')));
}

interface ImageInputOptions {
  dropTargets: HTMLElement[];
  pasteTarget: HTMLElement;
  onFile: (file: File) => void;
  onError: (error: Error) => void;
}

/** Bind only the requested writing/media surfaces; ordinary text paste stays native. */
export function bindImageInput({ dropTargets, pasteTarget, onFile, onError }: ImageInputOptions): () => void {
  function deliver(file: File) {
    try {
      validateImage(file);
      onFile(file);
    } catch (error) {
      onError(error instanceof Error ? error : new Error('无法读取此图片，请重新选择。'));
    }
  }

  function dragover(event: DragEvent) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function drop(event: DragEvent) {
    if (!hasFiles(event.dataTransfer)) return;
    // Prevent dropped files from navigating away, including unsupported files.
    event.preventDefault();
    event.stopPropagation();
    const image = imageFromTransfer(event.dataTransfer);
    if (image) deliver(image);
    else onError(new Error('请拖入 PNG、JPEG、GIF 或 WebP 图片；每次处理一张。'));
  }

  function paste(event: ClipboardEvent) {
    const image = imageFromTransfer(event.clipboardData);
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    deliver(image);
  }

  const targets = [...new Set(dropTargets)];
  for (const target of targets) {
    target.addEventListener('dragover', dragover);
    target.addEventListener('drop', drop);
  }
  pasteTarget.addEventListener('paste', paste);
  return () => {
    for (const target of targets) {
      target.removeEventListener('dragover', dragover);
      target.removeEventListener('drop', drop);
    }
    pasteTarget.removeEventListener('paste', paste);
  };
}
