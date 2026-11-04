export type FieldType =
  | 'text'
  | 'number'
  | 'textarea'
  | 'select'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'phone'
  | 'currency'
  | 'image'
  | 'images'
  | 'file'
  | 'files'
  | 'citizens'
  | 'districts'
  | 'crimes'
  | 'cards'
  | 'transfers'
  | 'model';

export type ModelType = 'nested' | 'relation';

export interface ModelConfig {
  /**
   * 'nested' - Obyekt ichida to'g'ridan-to'g'ri saqlanuvchi sub-struktura
   * 'relation' - Alohida jadval/entitiga bog'langan bog'liqlik
   */
  modelType: ModelType;

  /**
   * Model nomi: 'citizen' | 'crime' | 'district' | 'transfer' | 'card' | 'payment_provider'
   */
  modelName: string;

  /**
   * 1-variant: O'zining ichki maydonlari (Sub-schema / Sub-Template)
   */
  fields?: FieldDefinition[];

  /**
   * 2-variant: Boshqa mavjud sub-shablonga havola
   */
  templateId?: string;

  /**
   * Bir nechta element (Massiv/List) yoki yagona obyektmi?
   * Masalan: bitta arizada bir nechta fuqarolar yoki jinoyatlar bo'lishi mumkin (isList: true)
   */
  isList?: boolean;
}

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  defaultValue?: unknown;

  /**
   * Agar type === 'model' bo'lsa, modelning ichki konfiguratsiyasi
   */
  modelConfig?: ModelConfig;
}

export interface TemplateSchema {
  id: string;
  name: string;
  description?: string;
  version: string;
  fields: FieldDefinition[];
}
