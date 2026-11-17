/**
 * Telefon raqamlari va raqamli identifikatorlarni tozalash hamda normalizatsiya qilish yordamchilari
 */

export function normalizePhoneDigits(raw?: string | null): string {
  if (!raw) return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 9) {
    digits = `998${digits}`;
  } else if (digits.length === 8 && /^(90|91|93|94|95|97|98|99|33|50|77|88|20)/.test(digits)) {
    digits = `998${digits}`;
  }
  return digits;
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

export function normalizeIdentifierValue(type: string, raw?: string | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const t = (type || '').toLowerCase();

  if (t.includes('phone') || t.includes('telefon')) {
    return normalizePhoneDigits(trimmed);
  }
  if (t.includes('card') || t.includes('karta')) {
    return trimmed.replace(/\D/g, '');
  }
  if (t.includes('telegram_username') || t.includes('instagram') || t.includes('username')) {
    return trimmed
      .replace(/^https?:\/\/(t\.me|telegram\.me|instagram\.com)\//i, '')
      .replace(/^@+/, '')
      .replace(/\/+$/, '')
      .trim()
      .toLowerCase();
  }
  if (t.includes('telegram_id') || t.includes('imei')) {
    const onlyDigits = trimmed.replace(/\D/g, '');
    return onlyDigits || trimmed.toLowerCase();
  }
  if (t.includes('ip')) {
    return trimmed.toLowerCase().replace(/\s+/g, '');
  }
  if (t.includes('car') || t.includes('avto')) {
    return trimmed.replace(/\s+/g, '').toUpperCase();
  }
  if (t.includes('crypto') || t.includes('wallet')) {
    return trimmed.replace(/\s+/g, '');
  }
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
}

export function getIdentifierTypeLabel(type: string, customLabel?: string | null): string {
  if (customLabel && customLabel.trim()) return customLabel.trim();
  const map: Record<string, string> = {
    telegram_username: 'Telegram Username',
    telegram_id: 'Telegram ID',
    telegram_bio: 'Telegram Bio / Izoh',
    instagram_username: 'Instagram Username',
    phone_number: 'Telefon raqami',
    card_number: 'Bank plastik karta',
    crypto_wallet: 'Kripto-hamyon',
    ip_address: 'IP Manzil',
    imei: 'IMEI Kod',
    car_plate: 'Avtoraqam',
    website_domain: 'Veb-sayt / Domen',
    other_info: 'Boshqa maʼlumot',
  };
  return map[type] || type || 'Boshqa belgi';
}
