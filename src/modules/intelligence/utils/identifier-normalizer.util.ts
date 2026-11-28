/**
 * Telefon raqamlari va raqamli identifikatorlarni tozalash hamda normalizatsiya qilish yordamchilari
 */

export function normalizePhoneDigits(raw?: string | null): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 9) {
    digits = `998${digits}`;
  }
  return digits.slice(0, 20);
}

export function formatPhoneDisplay(digits?: string | null): string {
  const clean = normalizePhoneDigits(digits);
  if (clean.length === 12 && clean.startsWith('998')) {
    return `+${clean.slice(0, 3)} ${clean.slice(3, 5)} ${clean.slice(5, 8)} ${clean.slice(8, 10)} ${clean.slice(10, 12)}`;
  }
  if (clean.length > 0) {
    return `+${clean}`;
  }
  return '';
}

export function detectMobileOperator(digits?: string | null): string {
  const clean = normalizePhoneDigits(digits);
  if (!clean) return 'Nomaʼlum';
  if (clean.startsWith('998')) {
    const code = clean.slice(3, 5);
    switch (code) {
      case '90':
      case '91':
        return 'Beeline';
      case '93':
      case '94':
      case '50':
        return 'Ucell';
      case '99':
      case '95':
      case '77':
        return 'Uzmobile';
      case '97':
      case '88':
        return 'Mobiuz';
      case '33':
        return 'Humans';
      case '20':
        return 'OQ (Beeline)';
      case '98':
        return 'Perfectum';
      case '71':
      case '78':
        return 'Toshkent shahar tarmogʻi';
      case '75':
        return 'Qashqadaryo shahar tarmogʻi';
      default:
        return 'Oʻzbekiston aloqa tarmogʻi';
    }
  }
  if (clean.startsWith('7')) return 'Rossiya / Qozogʻiston (+7)';
  if (clean.startsWith('992')) return 'Tojikiston (+992)';
  if (clean.startsWith('996')) return 'Qirgʻiziston (+996)';
  if (clean.startsWith('90')) return 'Turkiya (+90)';
  if (clean.startsWith('1')) return 'AQSH / Kanada (+1)';
  return 'Xorijiy aloqa operatori';
}

/**
 * Erkin tavsif maydonlari — saqlanadi va ko'rsatiladi, lekin avtomatik bog'liqlik
 * (yolg'on moslik) yaratmaydi.
 */
export const NON_LINKABLE_IDENTIFIER_TYPES: ReadonlySet<string> = new Set([
  'telegram_bio',
  'other_info',
]);

export function isLinkableIdentifierType(type?: string | null): boolean {
  const clean = (type || '').trim().toLowerCase();
  if (!clean) return false;
  return !NON_LINKABLE_IDENTIFIER_TYPES.has(clean);
}

export function isPhoneLikeFieldKey(type?: string | null): boolean {
  const t = (type || '').trim().toLowerCase();
  return t.includes('phone') || t.includes('telefon') || t.includes('whatsapp');
}

export function isCardLikeFieldKey(type?: string | null): boolean {
  const t = (type || '').trim().toLowerCase();
  return (t.includes('card') || t.includes('karta')) && !t.includes('account');
}

export function normalizeIdentifierValue(type: string, raw?: string | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const t = (type || '').toLowerCase();

  if (isPhoneLikeFieldKey(t)) {
    return normalizePhoneDigits(trimmed);
  }
  if (isCardLikeFieldKey(t)) {
    return trimmed.replace(/\D/g, '');
  }
  if (t.includes('bank_account')) {
    return trimmed.replace(/\D/g, '').slice(0, 64);
  }
  if (
    t.includes('telegram_username') ||
    t.includes('telegram_bot') ||
    t.includes('telegram_channel') ||
    t.includes('instagram') ||
    t.includes('tiktok') ||
    t.includes('username')
  ) {
    return trimmed
      .replace(
        /^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|telegram\.dog|instagram\.com|tiktok\.com)\//i,
        '',
      )
      .replace(/[?#].*$/, '')
      .replace(/^@+/, '')
      .replace(/\/+$/, '')
      .trim()
      .toLowerCase()
      .slice(0, 255);
  }
  if (t.includes('website') || t.includes('domain') || t.includes('url') || t.includes('olx')) {
    return trimmed
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .trim()
      .toLowerCase()
      .slice(0, 255);
  }
  if (t.includes('apk') || t.includes('malware')) {
    return trimmed.toLowerCase().replace(/\s+/g, ' ').slice(0, 255);
  }
  if (t.includes('email')) {
    return trimmed.toLowerCase().replace(/\s+/g, '').slice(0, 255);
  }
  if (t.includes('exchange_uid') || t.includes('telegram_id') || t.includes('imei')) {
    const onlyDigits = trimmed.replace(/\D/g, '');
    return (onlyDigits || trimmed.toLowerCase()).slice(0, 255);
  }
  if (t === 'ip' || t.startsWith('ip_') || t.endsWith('_ip') || t.includes('ip_address')) {
    return trimmed.toLowerCase().replace(/\s+/g, '').slice(0, 255);
  }
  if (
    t === 'car_plate' ||
    t.includes('car_plate') ||
    t.includes('car_number') ||
    t.includes('avto')
  ) {
    return trimmed.replace(/\s+/g, '').toUpperCase().slice(0, 64);
  }
  if (t.includes('crypto') || t.includes('wallet')) {
    const compact = trimmed.replace(/\s+/g, '');
    // EVM (Ethereum/BSC/Polygon) manzillari case-insensitive hex — kichik harfga keltiramiz
    return (/^0x[0-9a-f]{40}$/i.test(compact) ? compact.toLowerCase() : compact).slice(0, 255);
  }
  return trimmed.toLowerCase().replace(/\s+/g, ' ').slice(0, 255);
}

export function getIdentifierTypeLabel(type: string, customLabel?: string | null): string {
  if (customLabel && customLabel.trim()) return customLabel.trim();
  const map: Record<string, string> = {
    telegram_username: 'Telegram Username',
    telegram_id: 'Telegram ID',
    telegram_bot: 'Telegram Bot',
    telegram_channel: 'Telegram Kanal / Guruh',
    telegram_bio: 'Telegram Bio / Izoh',
    instagram_username: 'Instagram Username',
    tiktok_username: 'TikTok Username',
    olx_account: 'OLX / Savdo akkaunti',
    phone_number: 'Telefon raqami',
    whatsapp_number: 'WhatsApp raqami',
    card_number: 'Bank plastik karta',
    bank_account: 'Bank hisob raqami',
    crypto_wallet: 'Kripto-hamyon',
    exchange_uid: 'Kripto-birja UID',
    website_domain: 'Phishing sayt / Havola',
    apk_file: 'Zararli APK / Ilova',
    ip_address: 'IP Manzil',
    imei: 'IMEI Kod',
    email: 'Email manzil',
    car_plate: 'Avtoraqam',
    other_info: 'Boshqa maʼlumot',
  };
  return map[type] || type || 'Boshqa belgi';
}
