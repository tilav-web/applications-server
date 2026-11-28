import {
  detectMobileOperator,
  formatPhoneDisplay,
  getIdentifierTypeLabel,
  isCardLikeFieldKey,
  isLinkableIdentifierType,
  isPhoneLikeFieldKey,
  normalizeIdentifierValue,
  normalizePhoneDigits,
} from './identifier-normalizer.util';

describe('identifier-normalizer.util', () => {
  describe('normalizePhoneDigits & formatPhoneDisplay', () => {
    it('normalizes 9-digit local Uzbek numbers by prepending 998', () => {
      expect(normalizePhoneDigits('90 123-45-67')).toBe('998901234567');
      expect(normalizePhoneDigits('+998 (99) 777-88-99')).toBe('998997778899');
    });

    it('preserves foreign numbers, caps at 20 digits, and returns empty string for null/blank', () => {
      expect(normalizePhoneDigits('+7 (999) 111-22-33')).toBe('79991112233');
      expect(normalizePhoneDigits('12345678901234567890999')).toHaveLength(20);
      expect(normalizePhoneDigits(null)).toBe('');
      expect(normalizePhoneDigits('---')).toBe('');
    });

    it('formats 12-digit UZ phone numbers and falls back to +digits for international', () => {
      expect(formatPhoneDisplay('901234567')).toBe('+998 90 123 45 67');
      expect(formatPhoneDisplay('+79991112233')).toBe('+79991112233');
      expect(formatPhoneDisplay('')).toBe('');
    });
  });

  describe('detectMobileOperator', () => {
    it('detects all major Uzbekistan mobile and regional operators', () => {
      expect(detectMobileOperator('901234567')).toBe('Beeline');
      expect(detectMobileOperator('931234567')).toBe('Ucell');
      expect(detectMobileOperator('501234567')).toBe('Ucell');
      expect(detectMobileOperator('771234567')).toBe('Uzmobile');
      expect(detectMobileOperator('881234567')).toBe('Mobiuz');
      expect(detectMobileOperator('331234567')).toBe('Humans');
      expect(detectMobileOperator('201234567')).toBe('OQ (Beeline)');
      expect(detectMobileOperator('981234567')).toBe('Perfectum');
      expect(detectMobileOperator('712001122')).toBe('Toshkent shahar tarmogʻi');
      expect(detectMobileOperator('752211122')).toBe('Qashqadaryo shahar tarmogʻi');
      expect(detectMobileOperator('998661234567')).toBe('Oʻzbekiston aloqa tarmogʻi');
    });

    it('detects foreign country prefixes and handles empty input', () => {
      expect(detectMobileOperator('+79991112233')).toBe('Rossiya / Qozogʻiston (+7)');
      expect(detectMobileOperator('+992901112233')).toBe('Tojikiston (+992)');
      expect(detectMobileOperator('+996700112233')).toBe('Qirgʻiziston (+996)');
      expect(detectMobileOperator('+905321234567')).toBe('Turkiya (+90)');
      expect(detectMobileOperator('+14155551234')).toBe('AQSH / Kanada (+1)');
      expect(detectMobileOperator('+442079460958')).toBe('Xorijiy aloqa operatori');
      expect(detectMobileOperator(null)).toBe('Nomaʼlum');
    });
  });

  describe('field key classifiers', () => {
    it('marks telegram_bio, other_info, and empty keys as non-linkable', () => {
      expect(isLinkableIdentifierType('telegram_bio')).toBe(false);
      expect(isLinkableIdentifierType('OTHER_INFO')).toBe(false);
      expect(isLinkableIdentifierType('')).toBe(false);
      expect(isLinkableIdentifierType('telegram_username')).toBe(true);
      expect(isLinkableIdentifierType('crypto_wallet')).toBe(true);
    });

    it('distinguishes phone-like and card-like keys while excluding bank/card accounts', () => {
      expect(isPhoneLikeFieldKey('whatsapp_number')).toBe(true);
      expect(isPhoneLikeFieldKey('telefon_raqami')).toBe(true);
      expect(isCardLikeFieldKey('card_number')).toBe(true);
      expect(isCardLikeFieldKey('karta_raqami')).toBe(true);
      expect(isCardLikeFieldKey('card_account')).toBe(false);
      expect(isCardLikeFieldKey('bank_account')).toBe(false);
    });
  });

  describe('normalizeIdentifierValue', () => {
    it('normalizes Telegram/Instagram/TikTok URLs with OR without protocol, @, and query params to the same handle', () => {
      expect(
        normalizeIdentifierValue('telegram_username', 'https://t.me/@Fraudster_1?start=123'),
      ).toBe('fraudster_1');
      expect(normalizeIdentifierValue('telegram_username', 't.me/Fraudster_1/')).toBe(
        'fraudster_1',
      );
      expect(normalizeIdentifierValue('telegram_username', '@@Fraudster_1')).toBe('fraudster_1');
      expect(
        normalizeIdentifierValue('instagram_username', 'www.instagram.com/Scam.Shop/?hl=ru'),
      ).toBe('scam.shop');
    });

    it('normalizes websites, emails, phones, cards, bank accounts, and numeric IDs', () => {
      expect(
        normalizeIdentifierValue('website_domain', 'https://www.Fake-Bank.UZ/login?id=1'),
      ).toBe('fake-bank.uz/login');
      expect(normalizeIdentifierValue('email', '  Scam.User @Gmail.COM ')).toBe(
        'scam.user@gmail.com',
      );
      expect(normalizeIdentifierValue('phone_number', '90-555-66-77')).toBe('998905556677');
      expect(normalizeIdentifierValue('card_number', '8600 1234 5678 9012')).toBe(
        '8600123456789012',
      );
      expect(normalizeIdentifierValue('bank_account', '20208 0009 0012-3456 7890')).toBe(
        '202080009001234567890',
      );
      expect(normalizeIdentifierValue('imei', '35-693803-564380-9')).toBe('356938035643809');
      expect(normalizeIdentifierValue('exchange_uid', 'UID-99887766')).toBe('99887766');
    });

    it('lowercases EVM 0x wallets while preserving case sensitivity of Base58 Tron/BTC wallets', () => {
      const evm = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';
      expect(normalizeIdentifierValue('crypto_wallet', `  ${evm} `)).toBe(evm.toLowerCase());
      const tron = 'TXyzAbC1234567890DeFgHiJkLmNoPqRsT';
      expect(normalizeIdentifierValue('crypto_wallet', ` ${tron} `)).toBe(tron);
    });

    it('does NOT mangle unrelated fields containing "ip" or "car" substrings, while normalizing real ip/car_plate fields', () => {
      // Regression: description / recipient_info must keep spaces
      expect(normalizeIdentifierValue('description', '  Ali   Valiyev  ')).toBe('ali valiyev');
      expect(normalizeIdentifierValue('recipient_info', 'Olim   Karimov')).toBe('olim karimov');
      expect(normalizeIdentifierValue('scarf_note', 'Qizil   sharf')).toBe('qizil sharf');

      // Real IP and car plate fields still strip spaces properly
      expect(normalizeIdentifierValue('ip_address', ' 192.168.1.10 ')).toBe('192.168.1.10');
      expect(normalizeIdentifierValue('client_ip', ' 10.0.0.1 ')).toBe('10.0.0.1');
      expect(normalizeIdentifierValue('car_plate', ' 01 a 777 aa ')).toBe('01A777AA');
      expect(normalizeIdentifierValue('avto_raqam', '70 b 123 ca')).toBe('70B123CA');
    });
  });

  describe('getIdentifierTypeLabel', () => {
    it('prefers customLabel, falls back to built-in map, then raw type or default', () => {
      expect(getIdentifierTypeLabel('crypto_wallet', '  Binance TRC20  ')).toBe('Binance TRC20');
      expect(getIdentifierTypeLabel('crypto_wallet')).toBe('Kripto-hamyon');
      expect(getIdentifierTypeLabel('custom_tag')).toBe('custom_tag');
      expect(getIdentifierTypeLabel('')).toBe('Boshqa belgi');
    });
  });
});
