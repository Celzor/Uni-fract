/** Refract supplies absolute avatar URLs; older hosts may use paths on their origin. */
export function resolveAvatarUrl(value, hostOrigin) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = hostOrigin ? new URL(value, hostOrigin) : new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Keep an initial underneath the photo so missing or unavailable pictures degrade quietly. */
export function createAvatar(person, hostOrigin) {
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = (person?.name || '?').slice(0, 1).toUpperCase();
  const url = resolveAvatarUrl(person?.avatarUrl, hostOrigin);
  if (!url) return avatar;

  const picture = document.createElement('img');
  picture.className = 'avatar-photo';
  picture.alt = '';
  picture.setAttribute('aria-hidden', 'true');
  picture.referrerPolicy = 'no-referrer';
  picture.decoding = 'async';
  picture.addEventListener('error', () => picture.remove(), { once: true });
  picture.src = url;
  avatar.append(picture);
  return avatar;
}
