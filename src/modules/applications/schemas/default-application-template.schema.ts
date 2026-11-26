import type { TemplateSchema } from './template-definition.interface';

// ============================================================================
// 1. PAYMENT PROVIDER SUB-TEMPLATE
// ============================================================================
export const PAYMENT_PROVIDER_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_payment_provider',
  name: "To'lov Provayderi Sub-Shabloni",
  version: '1.0.0',
  fields: [
    {
      key: 'name',
      label: 'Provayder Nomi',
      type: 'text',
      required: false,
      placeholder: 'Masalan: Payme, Click, Uzum Bank',
    },
    {
      key: 'code',
      label: 'Provayder Kodi',
      type: 'text',
      required: false,
      placeholder: 'payme, click, uzum',
    },
  ],
};

// ============================================================================
// 2. BANK SUB-TEMPLATE
// ============================================================================
export const BANK_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_bank',
  name: 'Tijorat Banki Sub-Shabloni',
  version: '1.0.0',
  fields: [
    {
      key: 'name',
      label: 'Bank Nomi',
      type: 'text',
      required: false,
      placeholder: 'Agrobank, Kapitalbank, Xalq banki',
    },
    {
      key: 'code',
      label: 'Bank Kodi',
      type: 'text',
      required: false,
      placeholder: 'AGRO, KAPITAL',
    },
    {
      key: 'mfo',
      label: 'MFO Kodi',
      type: 'text',
      required: false,
      placeholder: '00401',
    },
    {
      key: 'is_active',
      label: 'Faolmi',
      type: 'boolean',
      required: false,
      defaultValue: true,
    },
  ],
};

// ============================================================================
// 3. CARD SUB-TEMPLATE (Ichida Citizen va Bank modellari bilan bog'langan)
// ============================================================================
export const CARD_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_card',
  name: 'Plastik Karta Sub-Shabloni',
  version: '1.0.0',
  fields: [
    {
      key: 'card_number',
      label: 'Karta Raqami (16 talik)',
      type: 'text',
      required: false,
      placeholder: '8600123456789012',
    },
    {
      key: 'masked_number',
      label: 'Niqoblangan Raqam',
      type: 'text',
      required: false,
      placeholder: '8600 **** **** 9012',
    },
    {
      key: 'expire_date',
      label: 'Amal Qilish Muddati',
      type: 'text',
      required: false,
      placeholder: '12/28',
    },
    // Karta egasi (Fuqaro modeliga bog'lanish)
    {
      key: 'citizen',
      label: 'Karta Egasi (Fuqaro)',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'citizen',
        templateId: 'sub_template_citizen',
        isList: false,
      },
    },
    // Bank modeli bilan bog'lanish
    {
      key: 'bank',
      label: 'Tegishli Bank',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'bank',
        templateId: BANK_SUB_TEMPLATE.id,
        isList: false,
        fields: BANK_SUB_TEMPLATE.fields,
      },
    },
  ],
};

// ============================================================================
// 3. CUSTOM FIELD SUB-TEMPLATE (Universal Dinamik Maydonlar: Rasmlar, Fayllar, Matn)
// ============================================================================
export const CUSTOM_FIELD_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_custom_field',
  name: 'Dinamik Qo‘shimcha Maydon Sub-Shabloni',
  version: '1.0.0',
  fields: [
    {
      key: 'label',
      label: 'Maydon Nomi',
      type: 'text',
      required: false,
      placeholder: 'Masalan: Chek rasmi, Kvitansiya, Isbot uchun rasmlar',
    },
    {
      key: 'key',
      label: 'Maydon Kodi (slug)',
      type: 'text',
      required: false,
      placeholder: 'chek_rasmi, kvitansiya',
    },
    {
      key: 'type',
      label: 'Maydon Turi',
      type: 'select',
      required: false,
      options: [
        'STRING',
        'TEXT',
        'NUMBER',
        'BOOLEAN',
        'DATE',
        'IMAGES',
        'FILES',
        'SELECT',
        'CITIZENS',
        'DISTRICTS',
        'CRIMES',
        'CARDS',
        'TRANSFERS',
      ],
      defaultValue: 'STRING',
    },
    {
      key: 'value',
      label: 'Maydon Qiymati',
      type: 'text',
      required: false,
    },
  ],
};

// ============================================================================
// 4. TRANSFER SUB-TEMPLATE (Ichida Card, PaymentProvider va CustomFields bor)
// ============================================================================
export const TRANSFER_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_transfer',
  name: "To'lov O'tkazmasi Sub-Shabloni",
  version: '1.0.0',
  fields: [
    {
      key: 'transaction_id',
      label: 'Tranzaksiya ID',
      type: 'text',
      required: false,
      placeholder: 'TRX-99812',
    },
    {
      key: 'amount',
      label: "O'tkazma Miqdori",
      type: 'currency',
      required: false,
      placeholder: "450 000 so'm",
    },
    {
      key: 'currency',
      label: 'Valyuta',
      type: 'text',
      required: false,
      defaultValue: 'UZS',
    },
    {
      key: 'status',
      label: 'Tranzaksiya Holati',
      type: 'select',
      required: false,
      options: ['KUTILMOQDA', 'MUVAFFAQIYATLI', 'BEKOR_QILINDI'],
      defaultValue: 'KUTILMOQDA',
    },
    // Nested Sub-Template 1: Payment Provider
    {
      key: 'payment_provider',
      label: "To'lov Provayderi",
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'payment_provider',
        templateId: PAYMENT_PROVIDER_SUB_TEMPLATE.id,
        isList: false,
        fields: PAYMENT_PROVIDER_SUB_TEMPLATE.fields,
      },
    },
    // Nested Sub-Template 2: Sender Card (Pul yechilgan karta)
    {
      key: 'sender_card',
      label: 'Jo‘natuvchi Plastik Karta (Yechilgan karta)',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'card',
        templateId: CARD_SUB_TEMPLATE.id,
        isList: false,
        fields: CARD_SUB_TEMPLATE.fields,
      },
    },
    // Nested Sub-Template 3: Receiver Card (Pul tushgan karta)
    {
      key: 'receiver_card',
      label: 'Qabul Qiluvchi Plastik Karta (Tushgan karta)',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'card',
        templateId: CARD_SUB_TEMPLATE.id,
        isList: false,
        fields: CARD_SUB_TEMPLATE.fields,
      },
    },
    // Nested Sub-Template 3: Custom Fields (Chek rasmlari, kvitansiya, fayllar)
    {
      key: 'custom_fields',
      label: 'Qo‘shimcha Maydonlar (Chek, Kvitansiya, Fayllar)',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'transfer_custom_field',
        templateId: CUSTOM_FIELD_SUB_TEMPLATE.id,
        isList: true,
        fields: CUSTOM_FIELD_SUB_TEMPLATE.fields,
      },
    },
  ],
};

// ============================================================================
// 4. CITIZEN SUB-TEMPLATE
// ============================================================================
export const CITIZEN_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_citizen',
  name: 'Fuqaro Sub-Shabloni',
  version: '1.0.0',
  fields: [
    {
      key: 'full_name',
      label: 'F.I.SH.',
      type: 'text',
      required: false,
      placeholder: 'Aliyev Valijon Karimovich',
    },
    {
      key: 'passport',
      label: 'Pasport Seriya va Raqami',
      type: 'text',
      required: false,
      placeholder: 'AC1234567',
    },
    {
      key: 'pinfl',
      label: 'JShShIR (PINFL)',
      type: 'text',
      required: false,
      placeholder: '31204951230045',
    },
    {
      key: 'phone_number',
      label: 'Telefon Raqami (998XXXXXXXXX)',
      type: 'phone',
      required: false,
      placeholder: '998991234567',
    },
    {
      key: 'address',
      label: 'Doimiy Yashash Manzili',
      type: 'text',
      required: false,
      placeholder: 'Toshkent sh., Yunusobod t., 4-mavze 12-uy',
    },
  ],
};

// ============================================================================
// 5. CRIME SUB-TEMPLATE
// ============================================================================
export const CRIME_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_crime',
  name: 'Jinoyat Turi Sub-Shabloni',
  version: '1.0.0',
  fields: [
    {
      key: 'article',
      label: 'Jinoyat Turi',
      type: 'text',
      required: false,
      placeholder: 'Firibgarlik',
    },
    {
      key: 'title',
      label: 'Jinoyat Tavsifi (Nomi)',
      type: 'text',
      required: false,
      placeholder: 'Firibgarlik',
    },
    {
      key: 'part',
      label: 'Modda Qismlari',
      type: 'text',
      required: false,
      placeholder: '1, 2, 3-qismlar',
    },
    {
      key: 'category',
      label: 'Jinoyat Sohasi / Toifasi',
      type: 'text',
      required: false,
      placeholder: 'Iqtisodiy sohadagi jinoyatlar',
    },
    {
      key: 'gravity',
      label: 'Og‘irlik Darajasi',
      type: 'select',
      required: false,
      options: ['UNCHA_OGIR_BOLMAGAN', 'ORTA_OGIR', 'OGIR', 'JUDA_OGIR'],
      defaultValue: 'ORTA_OGIR',
    },
    {
      key: 'description',
      label: 'Qo‘shimcha Izoh',
      type: 'textarea',
      required: false,
    },
  ],
};

// ============================================================================
// 6. DISTRICT SUB-TEMPLATE
// ============================================================================
export const DISTRICT_SUB_TEMPLATE: TemplateSchema = {
  id: 'sub_template_district',
  name: 'Tuman / Bo‘lim Sub-Shabloni',
  version: '1.0.0',
  fields: [
    {
      key: 'name',
      label: 'Tuman / Bo‘lim Nomi',
      type: 'text',
      required: false,
      placeholder: 'Yunusobod tumani IIB',
    },
    {
      key: 'code',
      label: 'Bo‘lim Kodi',
      type: 'text',
      required: false,
      placeholder: 'YUNUSOBOD_IIB',
    },
  ],
};

// ============================================================================
// 7. MASTER APPLICATION TEMPLATE (Barcha Sub-shablonlarni jamlovchi bosh shablon)
// ============================================================================
export const APPLICATION_MASTER_TEMPLATE: TemplateSchema = {
  id: 'master_application_template',
  name: 'Arizalarning Universal Bosh Shabloni',
  description:
    'Ichma-ich sub-modellarni (fuqarolar, jinoyatlar, tumanlar, kartalar, o‘tkazmalar va dinamik maydonlar) o‘z ichiga olgan asosiy ariza shabloni',
  version: '1.0.0',
  fields: [
    // Asosiy maydonlar
    {
      key: 'application_number',
      label: 'Ariza Raqami',
      type: 'text',
      required: false,
      placeholder: '2026-00451',
    },
    {
      key: 'title',
      label: 'Ariza Mavzusi',
      type: 'text',
      required: false,
      placeholder: 'Mol-mulk yo‘qolishi bo‘yicha ariza',
    },
    {
      key: 'description',
      label: 'Ariza Mazmuni',
      type: 'textarea',
      required: false,
      placeholder: 'Ariza tafsilotlari...',
    },
    {
      key: 'status',
      label: 'Ariza Holati',
      type: 'select',
      required: false,
      options: ['YANGI', 'JARAYONDA', 'HAL_QILINDI', 'RAD_ETILDI'],
      defaultValue: 'YANGI',
    },
    {
      key: 'date',
      label: 'Ariza Qabul Qilingan Sana',
      type: 'datetime',
      required: false,
    },

    // ------------------------------------------------------------------------
    // SUB-MODEL 1: Fuqarolar (Bir arizada bir nechta bo'lishi mumkin: isList: true)
    // ------------------------------------------------------------------------
    {
      key: 'citizens',
      label: 'Arizachi va Aloqador Fuqarolar',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'citizen',
        templateId: CITIZEN_SUB_TEMPLATE.id,
        isList: true, // Bir nechta fuqaro
        fields: CITIZEN_SUB_TEMPLATE.fields,
      },
    },

    // ------------------------------------------------------------------------
    // SUB-MODEL 2: Jinoyat Moddalari (Bir arizada bir nechta bo'lishi mumkin)
    // ------------------------------------------------------------------------
    {
      key: 'crimes',
      label: 'Tegishli Jinoyat Moddalari',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'crime',
        templateId: CRIME_SUB_TEMPLATE.id,
        isList: true, // Bir nechta jinoyat moddasi
        fields: CRIME_SUB_TEMPLATE.fields,
      },
    },

    // ------------------------------------------------------------------------
    // SUB-MODEL 3: Tumanlar / Bo'limlar
    // ------------------------------------------------------------------------
    {
      key: 'districts',
      label: 'Mas’ul Tuman Bo‘limlari',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'district',
        templateId: DISTRICT_SUB_TEMPLATE.id,
        isList: true, // Bir nechta tuman
        fields: DISTRICT_SUB_TEMPLATE.fields,
      },
    },

    // ------------------------------------------------------------------------
    // SUB-MODEL 4: Plastik Kartalar (To'g'ridan-to'g'ri biriktirilgan kartalar)
    // ------------------------------------------------------------------------
    {
      key: 'cards',
      label: 'Arizaga Biriktirilgan Kartalar',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'card',
        templateId: CARD_SUB_TEMPLATE.id,
        isList: true, // Bir nechta karta
        fields: CARD_SUB_TEMPLATE.fields,
      },
    },

    // ------------------------------------------------------------------------
    // SUB-MODEL 5: O'tkazmalar (Ichida Card va PaymentProvider sub-modellari bor)
    // ------------------------------------------------------------------------
    {
      key: 'transfers',
      label: 'Moliyaviy To‘lov O‘tkazmalari',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'transfer',
        templateId: TRANSFER_SUB_TEMPLATE.id,
        isList: true, // Bir nechta o'tkazma
        fields: TRANSFER_SUB_TEMPLATE.fields,
      },
    },

    // ------------------------------------------------------------------------
    // SUB-MODEL 6: Dinamik Qo'shimcha Maydonlar (Rasmlar, Fayllar, Matn va h.k.)
    // ------------------------------------------------------------------------
    {
      key: 'custom_fields',
      label: 'Qo‘shimcha Maydonlar (Rasmlar, Fayllar, Izohlar)',
      type: 'model',
      required: false,
      modelConfig: {
        modelType: 'relation',
        modelName: 'application_custom_field',
        templateId: CUSTOM_FIELD_SUB_TEMPLATE.id,
        isList: true,
        fields: CUSTOM_FIELD_SUB_TEMPLATE.fields,
      },
    },
  ],
};
