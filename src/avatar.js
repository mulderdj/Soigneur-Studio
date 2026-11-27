// @ts-check
//
// Rider avatars: validation and client-side square cropping/resizing to a
// compact data URL suitable for localStorage and /api/me/profile sync.
//

const MAX_AVATAR_LEN = 48000;
const AVATAR_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * @param {unknown} val
 * @returns {val is string}
 */
function isValidAvatar(val) {
    return typeof val === 'string' && val.length <= MAX_AVATAR_LEN && AVATAR_RE.test(val);
}

/**
 * @param {File} file
 * @returns {Promise<{source: CanvasImageSource, width: number, height: number, close: () => void}>}
 */
function decodeViaImg(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({
                source: img,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                close: () => {},
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Could not read that image. Try a JPEG, PNG or WebP photo.'));
        };
        img.src = url;
    });
}

/**
 * @param {File} file
 */
async function decodeImage(file) {
    if(typeof createImageBitmap === 'function') {
        try {
            const bmp = await createImageBitmap(file);
            return {
                source: bmp,
                width: bmp.width,
                height: bmp.height,
                close: () => bmp.close?.(),
            };
        } catch(e) {
            return decodeViaImg(file);
        }
    }
    return decodeViaImg(file);
}

/**
 * Center-crop an image File to a square and encode it as a compact data URL.
 * @param {File} file
 * @param {number} [size=128]
 * @returns {Promise<string>}
 */
async function resizeAvatarFile(file, size = 128) {
    if(!file || typeof file.type !== 'string' || !file.type.startsWith('image/')) {
        throw new Error('Choose an image file (JPEG, PNG or WebP).');
    }

    const decoded = await decodeImage(file);
    try {
        if(!(decoded.width > 0 && decoded.height > 0)) {
            throw new Error('Could not read that image. Try a JPEG, PNG or WebP photo.');
        }

        const side = Math.min(decoded.width, decoded.height);
        const sx = (decoded.width - side) / 2;
        const sy = (decoded.height - side) / 2;

        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if(!ctx) throw new Error('Could not process that image in this browser.');

        ctx.drawImage(decoded.source, sx, sy, side, side, 0, 0, size, size);

        const qualities = [0.82, 0.68, 0.54, 0.4];
        for(const mime of ['image/webp', 'image/jpeg']) {
            for(const quality of qualities) {
                const url = canvas.toDataURL(mime, quality);
                if(!url.startsWith(`data:${mime};base64,`)) break;
                if(isValidAvatar(url)) return url;
            }
        }

        throw new Error('That photo is too large even after resizing. Try a simpler image.');
    } finally {
        decoded.close();
    }
}

export { MAX_AVATAR_LEN, isValidAvatar, resizeAvatarFile };
