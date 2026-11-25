/**
 * Bank kartasidan pul o'tkazmasidan tashqari yetkazilgan moddiy zarar turlari:
 * onlayn kredit, nasiya/bo'lib to'lash, pasport/telefon orqali xarid va b.
 */
export enum ApplicationDamageType {
  /** Fuqaro nomiga onlayn kredit / mikroqarz rasmiylashtirish */
  ONLINE_CREDIT = 'ONLINE_CREDIT',
  /** Nasiya / bo'lib to'lash platformalari (Uzum Nasiya, Alif, Open va b.) */
  INSTALLMENT = 'INSTALLMENT',
  /** Tovar, xizmat, onlayn savdo yoki akkaunt (o'yin/ijtimoiy tarmoq) aldovi */
  GOODS_SERVICE = 'GOODS_SERVICE',
  /** Naqd pul, bank hisob raqami yoki boshqa to'g'ridan-to'g'ri to'lov */
  CASH_OTHER = 'CASH_OTHER',
  /** Boshqa turdagi moddiy zarar */
  OTHER = 'OTHER',
}

export const APPLICATION_DAMAGE_TYPE_LABELS: Record<ApplicationDamageType, string> = {
  [ApplicationDamageType.ONLINE_CREDIT]: 'Onlayn kredit / Mikroqarz',
  [ApplicationDamageType.INSTALLMENT]: "Nasiya / Bo'lib to'lash",
  [ApplicationDamageType.GOODS_SERVICE]: 'Tovar / Xizmat / Akkaunt aldovi',
  [ApplicationDamageType.CASH_OTHER]: 'Naqd pul / Hisob raqam',
  [ApplicationDamageType.OTHER]: 'Boshqa moddiy zarar',
};
