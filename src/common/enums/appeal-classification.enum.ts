/**
 * O'zbekiston Respublikasi "Jismoniy va yuridik shaxslarning murojaatlari to'g'risida"gi Qonuni
 * (O'RQ-445) va JPK 322-324-moddalari asosida murojaat tasniflari.
 */
export enum AppealType {
  /** Ariza — huquq va manfaatlarni himoya qilishda yordam so'rash / jinoyat haqida xabar */
  APPEAL = 'APPEAL',
  /** Shikoyat — buzilgan huquqlarni tiklash yoki qaror ustidan talab */
  COMPLAINT = 'COMPLAINT',
  /** Taklif — faoliyatni takomillashtirish bo'yicha tavsiya */
  PROPOSAL = 'PROPOSAL',
}

export enum SubmissionForm {
  /** Yozma murojaat (qog'oz, pochta) */
  WRITTEN = 'WRITTEN',
  /** Og'zaki murojaat (shaxsiy qabul, 102/112) */
  ORAL = 'ORAL',
  /** Elektron murojaat (my.gov.uz, pm.gov.uz, elektron pochta) */
  ELECTRONIC = 'ELECTRONIC',
}

export enum ApplicantType {
  /** Yakka tartibdagi (jismoniy shaxs) */
  INDIVIDUAL = 'INDIVIDUAL',
  /** Jamoaviy (2 va undan ortiq fuqaro) */
  COLLECTIVE = 'COLLECTIVE',
  /** Yuridik shaxs / tashkilot / mansabdor shaxs xabari */
  LEGAL_ENTITY = 'LEGAL_ENTITY',
  /** Anonim murojaat */
  ANONYMOUS = 'ANONYMOUS',
  /** Aybini bo'yniga olish to'g'risida arz (JPK 324-modda) */
  CONFESSION = 'CONFESSION',
}

export enum ApplicationRepeatType {
  /** Birlamchi — holat bo'yicha ilk murojaat */
  PRIMARY = 'PRIMARY',
  /** Takroriy — avvalgi qarordan norozilik / muddatida ko'rilmaganlik bo'yicha qayta murojaat */
  REPEAT = 'REPEAT',
  /** Dublikat — ayni bir murojaatning ko'chirma nusxasi (102 + portal + prokuratura) */
  DUPLICATE = 'DUPLICATE',
  /** Qo'shimcha — avvalgi arizaga yangi fakt, karta, o'tkazma yoki dalil qo'shish */
  SUPPLEMENTAL = 'SUPPLEMENTAL',
}

export const APPEAL_TYPE_LABELS: Record<AppealType, string> = {
  [AppealType.APPEAL]: 'Ariza',
  [AppealType.COMPLAINT]: 'Shikoyat',
  [AppealType.PROPOSAL]: 'Taklif',
};

export const SUBMISSION_FORM_LABELS: Record<SubmissionForm, string> = {
  [SubmissionForm.WRITTEN]: 'Yozma',
  [SubmissionForm.ORAL]: "Og'zaki",
  [SubmissionForm.ELECTRONIC]: 'Elektron',
};

export const APPLICANT_TYPE_LABELS: Record<ApplicantType, string> = {
  [ApplicantType.INDIVIDUAL]: 'Yakka tartibdagi',
  [ApplicantType.COLLECTIVE]: 'Jamoaviy',
  [ApplicantType.LEGAL_ENTITY]: 'Yuridik shaxs / tashkilot',
  [ApplicantType.ANONYMOUS]: 'Anonim',
  [ApplicantType.CONFESSION]: "Aybini bo'yniga olish arzi",
};

export const REPEAT_TYPE_LABELS: Record<ApplicationRepeatType, string> = {
  [ApplicationRepeatType.PRIMARY]: 'Birlamchi',
  [ApplicationRepeatType.REPEAT]: 'Takroriy',
  [ApplicationRepeatType.DUPLICATE]: 'Dublikat',
  [ApplicationRepeatType.SUPPLEMENTAL]: "Qo'shimcha",
};
