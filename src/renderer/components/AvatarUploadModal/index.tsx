import { useEffect, useMemo, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import Modal from '@/renderer/components/Modal';
import styles from './index.module.scss';
import { avatarRemove, avatarSave, emitAvatarUpdated } from '@/services/avatar';
import { InfoButton } from '@/renderer/components/InfoListCard';
function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

async function cropToPngBytes(params: {
  imageSrc: string;
  crop: Area;
  outputSize: number;
}): Promise<Uint8Array> {
  const image = await createImage(params.imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = params.outputSize;
  canvas.height = params.outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');

  const { x, y, width, height } = params.crop;
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.floor(width));
  const sh = Math.max(1, Math.floor(height));

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, params.outputSize, params.outputSize);

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('Failed to export image'));
        resolve(b);
      },
      'image/png',
      1,
    );
  });
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

async function normalizeImageBlob(blob: Blob): Promise<Blob> {
  // Fix common JPEG EXIF orientation issues by re-encoding once (best-effort).
  try {
    if (typeof createImageBitmap !== 'function') return blob;
    if (
      !String(blob.type || '')
        .toLowerCase()
        .includes('jpeg')
    )
      return blob;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as any);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0);
    const out: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png', 1);
    });
    try {
      bmp.close?.();
    } catch {
      // ignore
    }
    return out;
  } catch {
    return blob;
  }
}

function guessMimeTypeFromPath(filePath: string): string {
  const p = String(filePath || '').toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

async function readFileAsBytes(filePath: string): Promise<Uint8Array> {
  // renderer has nodeIntegration enabled in this app, but keep it defensive.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs');
    const buf: Buffer = await fs.promises.readFile(filePath);
    return new Uint8Array(buf);
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    throw new Error(`读取文件失败: ${String((e as any)?.message || e)}`);
  }
}

type AvatarUploadModalProps = {
  open: boolean;
  onClose: () => void;
  userKey: string;
  hasExistingAvatar: boolean;
  onSaved: (fileUrl: string) => void;
  onRemoved: () => void;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ZOOM_MIN = 1;
const ZOOM_MAX = 3;

export default function AvatarUploadModal(props: AvatarUploadModalProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const canSave = !!imageSrc && !!croppedAreaPixels && !saving && !loadingFile;
  const zoomProgress = Math.min(
    100,
    Math.max(0, ((zoom - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100),
  );

  const resetState = () => {
    setImageSrc(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setSaving(false);
    setLoadingFile(false);
    setIsDragOver(false);
    setErrorMsg(null);
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {
        // ignore
      }
      objectUrlRef.current = null;
    }
  };

  useEffect(() => {
    if (!props.open) {
      resetState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open]);

  const dialogFilters = useMemo(
    () => [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    [],
  );

  const processFile = async (fileOrPath: File | string) => {
    setErrorMsg(null);
    setLoadingFile(true);
    try {
      let bytes: Uint8Array;
      let mimeType: string;

      if (typeof fileOrPath === 'string') {
        bytes = await readFileAsBytes(fileOrPath);
        mimeType = guessMimeTypeFromPath(fileOrPath);
      } else {
        // File object from Drop or Input
        const buf = await fileOrPath.arrayBuffer();
        bytes = new Uint8Array(buf);
        mimeType = fileOrPath.type || guessMimeTypeFromPath(fileOrPath.name || '');
      }

      if (bytes.byteLength > MAX_FILE_SIZE) {
        throw new Error('图片过大（建议小于 10MB）');
      }

      // Ensure we have a valid Blob
      // TS/DOM lib: BlobPart expects ArrayBuffer, but Node's Uint8Array may be typed with ArrayBufferLike
      const ab = (bytes.buffer as ArrayBuffer).slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
      const rawBlob = new Blob([ab], { type: mimeType });
      const blob = await normalizeImageBlob(rawBlob);
      const url = URL.createObjectURL(blob);

      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch {
          // ignore
        }
      }
      objectUrlRef.current = url;
      setImageSrc(url);
      setZoom(1);
      setCrop({ x: 0, y: 0 });
      setCroppedAreaPixels(null);
    } catch (e: any) {
      console.error('Process file failed:', e);
      setErrorMsg(e.message || '读取图片失败');
    } finally {
      setLoadingFile(false);
    }
  };

  const chooseImage = async () => {
    if (saving || loadingFile) return;
    try {
      let filePath: string | null = null;
      const showOpenDialog = (window as any)?.sensetype?.showOpenDialog as
        | ((options: any) => { canceled?: boolean; filePaths?: string[] })
        | undefined;

      if (showOpenDialog) {
        const res = showOpenDialog({
          title: '选择头像图片',
          properties: ['openFile'],
          filters: dialogFilters,
        });
        if (res?.canceled) {
          return;
        }
        const fp = res?.filePaths?.[0];
        filePath = fp ? String(fp) : null;
      }

      // Fallback: invisible file input
      if (!filePath && !showOpenDialog) {
        // Use a temp input to pick file
        await new Promise<void>((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/png,image/jpeg,image/webp';
          input.onchange = () => {
            const f = input.files?.[0];
            if (f) {
              // Prefer path if available (Electron), else File object
              const p = (f as any).path;
              if (p) processFile(p);
              else processFile(f);
            }
            resolve();
          };
          input.click();
        });
        return;
      }

      if (filePath) {
        await processFile(filePath);
      }
    } catch (e: any) {
      console.error('Choose image failed:', e);
      setErrorMsg(e.message || '选择图片失败');
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!saving && !loadingFile) {
      setIsDragOver(true);
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (saving || loadingFile) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Check if it's an image
      if (!file.type.startsWith('image/') && !file.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
        setErrorMsg('请选择图片文件 (PNG/JPG/WebP)');
        return;
      }
      // Prefer path if available (Electron)
      const p = (file as any).path;
      if (p) await processFile(p);
      else await processFile(file);
    }
  };

  const onCropComplete = (_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    if (saving) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      const bytes = await cropToPngBytes({
        imageSrc,
        crop: croppedAreaPixels,
        outputSize: 256,
      });
      const info = await avatarSave({
        userKey: props.userKey,
        bytes,
        mimeType: 'image/png',
      });
      props.onSaved(info.fileUrl);
      emitAvatarUpdated({
        userKey: props.userKey,
        fileUrl: info.fileUrl,
        updatedAt: info.updatedAt,
      });
      props.onClose();
    } catch (e: any) {
      console.error('[avatar] save failed:', e);
      setErrorMsg(e.message || '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (saving) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      await avatarRemove(props.userKey);
      props.onRemoved();
      emitAvatarUpdated({ userKey: props.userKey, fileUrl: null });
      props.onClose();
    } catch (e: any) {
      console.error('[avatar] remove failed:', e);
      setErrorMsg(e.message || '删除失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="设置头像"
      subtitle="选择图片并裁剪成圆形头像（1:1）"
      className={styles.modalWide}
      footer={
        <div className={styles.footer}>
          {errorMsg && <span className={styles.errorMessage}>{errorMsg}</span>}
          <div className={styles.btnRow}>
            <InfoButton onClick={chooseImage} disabled={saving || loadingFile} variant="secondary">
              {imageSrc ? '重新选择' : '选择图片'}
            </InfoButton>
            {props.hasExistingAvatar ? (
              <InfoButton
                onClick={handleRemove}
                disabled={saving || loadingFile}
                variant="dangerOutline"
              >
                删除头像
              </InfoButton>
            ) : null}
          </div>
          <div className={styles.btnRow}>
            <InfoButton onClick={props.onClose} disabled={saving} variant="secondary">
              取消
            </InfoButton>
            <InfoButton onClick={handleSave} disabled={!canSave} variant="primary">
              {saving ? '保存中…' : '保存'}
            </InfoButton>
          </div>
        </div>
      }
    >
      <div className={styles.body}>
        <div className={styles.layout}>
          <div
            className={`${styles.cropArea} ${!imageSrc ? styles.cropAreaEmpty : ''} ${
              isDragOver ? styles.cropAreaDragOver : ''
            }`}
            onClick={() => {
              if (!imageSrc) void chooseImage();
            }}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            role={!imageSrc ? 'button' : undefined}
            tabIndex={!imageSrc ? 0 : -1}
            onKeyDown={(e) => {
              if (!imageSrc && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                void chooseImage();
              }
            }}
          >
            {imageSrc ? (
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            ) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon} aria-hidden />
                <div className={styles.emptyTitle}>
                  {loadingFile ? '正在读取…' : isDragOver ? '松开以添加' : '选择一张清晰头像'}
                </div>
                <div className={styles.emptyDesc}>
                  {isDragOver
                    ? '支持 PNG/JPG/WebP'
                    : '点击或拖拽图片到此处（支持 PNG/JPG/WebP，最大 10MB）'}
                </div>
              </div>
            )}
          </div>

          <div className={styles.side}>
            <div className={styles.previewCard}>
              <div className={styles.previewCircle}>
                {imageSrc ? <img src={imageSrc} alt="" /> : null}
              </div>
              <div className={styles.previewMeta}>
                <div className={styles.previewTitle}>预览</div>
                <div className={styles.previewDesc}>保存后将在侧边栏头像处显示</div>
              </div>
            </div>

            <div className={styles.controlsRow}>
              <span className={styles.label}>缩放</span>
              <input
                className={styles.slider}
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                disabled={!imageSrc || saving || loadingFile}
                style={
                  {
                    '--range-progress': `${zoomProgress}%`,
                  } as React.CSSProperties
                }
              />
              <span className={styles.hint}>
                {imageSrc ? '拖动图片调整位置' : '选择图片后可调整'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
