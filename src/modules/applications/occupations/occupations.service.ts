import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Occupation } from './occupation.entity';
import { OccupationCategory } from './occupation-category.entity';

@Injectable()
export class OccupationsService implements OnModuleInit {
  constructor(
    @InjectRepository(OccupationCategory)
    private readonly categoryRepo: Repository<OccupationCategory>,
    @InjectRepository(Occupation)
    private readonly occupationRepo: Repository<Occupation>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  // ==========================================================================
  // CATEGORIES
  // ==========================================================================
  async findAllCategories(includeInactive = false): Promise<OccupationCategory[]> {
    const qb = this.categoryRepo
      .createQueryBuilder('cat')
      .leftJoinAndSelect(
        'cat.occupations',
        'occ',
        includeInactive ? undefined : 'occ.is_active = :occActive',
        includeInactive ? undefined : { occActive: true },
      )
      .orderBy('cat.sort_order', 'ASC')
      .addOrderBy('cat.name', 'ASC')
      .addOrderBy('occ.sort_order', 'ASC')
      .addOrderBy('occ.name', 'ASC');

    if (!includeInactive) {
      qb.where('cat.is_active = :active', { active: true });
    }

    return qb.getMany();
  }

  async findCategoryById(id: string): Promise<OccupationCategory> {
    const cat = await this.categoryRepo.findOne({
      where: { id },
      relations: { occupations: true },
    });
    if (!cat) throw new NotFoundException('Kasb toifasi topilmadi');
    return cat;
  }

  async createCategory(data: {
    name: string;
    code?: string;
    sort_order?: number;
    is_active?: boolean;
  }): Promise<OccupationCategory> {
    const cleanName = data.name.trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const existing = await this.categoryRepo
      .createQueryBuilder('c')
      .where('LOWER(c.name) = LOWER(:name)', { name: cleanName })
      .getOne();

    if (existing) {
      return existing;
    }

    const category = this.categoryRepo.create({
      name: cleanName,
      code: data.code?.trim() || null,
      sort_order: data.sort_order ?? 0,
      is_active: data.is_active ?? true,
    });

    return this.categoryRepo.save(category);
  }

  async updateCategory(
    id: string,
    data: { name?: string; code?: string; sort_order?: number; is_active?: boolean },
  ): Promise<OccupationCategory> {
    const cat = await this.findCategoryById(id);
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      const existing = await this.categoryRepo
        .createQueryBuilder('c')
        .where('LOWER(c.name) = LOWER(:name) AND c.id != :id', { name: cleanName, id })
        .getOne();
      if (existing) throw new BadRequestException('Bunday toifa allaqachon mavjud');
      cat.name = cleanName;
    }
    if (data.code !== undefined) cat.code = data.code?.trim() || null;
    if (data.sort_order !== undefined) cat.sort_order = data.sort_order;
    if (data.is_active !== undefined) cat.is_active = data.is_active;

    return this.categoryRepo.save(cat);
  }

  async removeCategory(id: string): Promise<{ success: boolean; message: string }> {
    const cat = await this.findCategoryById(id);
    await this.categoryRepo.remove(cat);
    return { success: true, message: "Kasb toifasi o'chirildi" };
  }

  // ==========================================================================
  // OCCUPATIONS (Turlar)
  // ==========================================================================
  async findAllOccupations(categoryId?: string, includeInactive = false): Promise<Occupation[]> {
    const qb = this.occupationRepo
      .createQueryBuilder('occ')
      .leftJoinAndSelect('occ.category', 'cat')
      .orderBy('occ.sort_order', 'ASC')
      .addOrderBy('occ.name', 'ASC');

    if (categoryId) {
      qb.where('occ.category_id = :catId', { catId: categoryId });
    }
    if (!includeInactive) {
      qb.andWhere('occ.is_active = :active', { active: true });
    }

    return qb.getMany();
  }

  async findOccupationById(id: string): Promise<Occupation> {
    const occ = await this.occupationRepo.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!occ) throw new NotFoundException('Kasb turi topilmadi');
    return occ;
  }

  async createOccupation(data: {
    category_id: string;
    name: string;
    code?: string;
    sort_order?: number;
    is_active?: boolean;
  }): Promise<Occupation> {
    const cleanName = data.name.trim();
    if (!cleanName) throw new BadRequestException('Nom kiritilishi shart');

    const cat = await this.categoryRepo.findOne({ where: { id: data.category_id } });
    if (!cat) throw new NotFoundException('Tanlangan toifa topilmadi');

    const existing = await this.occupationRepo
      .createQueryBuilder('o')
      .where('o.category_id = :catId AND LOWER(o.name) = LOWER(:name)', {
        catId: data.category_id,
        name: cleanName,
      })
      .getOne();

    if (existing) {
      return existing;
    }

    const occ = this.occupationRepo.create({
      category_id: data.category_id,
      name: cleanName,
      code: data.code?.trim() || null,
      sort_order: data.sort_order ?? 0,
      is_active: data.is_active ?? true,
    });

    return this.occupationRepo.save(occ);
  }

  async updateOccupation(
    id: string,
    data: {
      category_id?: string;
      name?: string;
      code?: string;
      sort_order?: number;
      is_active?: boolean;
    },
  ): Promise<Occupation> {
    const occ = await this.findOccupationById(id);
    if (data.category_id !== undefined) {
      const cat = await this.categoryRepo.findOne({ where: { id: data.category_id } });
      if (!cat) throw new NotFoundException('Tanlangan toifa topilmadi');
      occ.category_id = data.category_id;
      delete (occ as unknown as Record<string, unknown>).category;
    }
    if (data.name !== undefined) {
      const cleanName = data.name.trim();
      const existing = await this.occupationRepo
        .createQueryBuilder('o')
        .where('o.category_id = :catId AND LOWER(o.name) = LOWER(:name) AND o.id != :id', {
          catId: occ.category_id,
          name: cleanName,
          id,
        })
        .getOne();
      if (existing) throw new BadRequestException('Bu toifada bunday kasb allaqachon mavjud');
      occ.name = cleanName;
    }
    if (data.code !== undefined) occ.code = data.code?.trim() || null;
    if (data.sort_order !== undefined) occ.sort_order = data.sort_order;
    if (data.is_active !== undefined) occ.is_active = data.is_active;

    await this.occupationRepo.save(occ);
    return this.findOccupationById(id);
  }

  async removeOccupation(id: string): Promise<{ success: boolean; message: string }> {
    const occ = await this.findOccupationById(id);
    await this.occupationRepo.remove(occ);
    return { success: true, message: "Kasb o'chirildi" };
  }

  // ==========================================================================
  // SEED DEFAULT OCCUPATIONS (O'zbekistonda keng tarqalgan kasb toifalari va turlari)
  // ==========================================================================
  async seedDefaults(): Promise<void> {
    const initialData: { code: string; category: string; items: string[] }[] = [
      {
        code: 'DAVLAT_XIZMATI',
        category: 'Davlat boshqaruvi va xizmati',
        items: [
          'Hokimiyat xodimi',
          'Vazirlik / davlat idorasi xodimi',
          'Mahalla xodimi (rais, hokim yordamchisi va b.)',
          'Soliq / bojxona / kadastr xodimi',
          'Davlat xizmatlari markazi xodimi',
          'Boshqa davlat xizmatchisi',
        ],
      },
      {
        code: 'HUQUQ_TARTIBOT',
        category: 'Huquq-tartibot va harbiy soha',
        items: [
          'Huquq-tartibot organlari xodimi',
          'Harbiy xizmatchi (Mudofaa / Milliy gvardiya)',
          'Favqulodda vaziyatlar xodimi (FVV)',
          'Sud / prokuratura / adliya xodimi',
          'Advokat / huquqshunos (yurist)',
        ],
      },
      {
        code: 'TALIM_FAN',
        category: "Ta'lim va fan",
        items: [
          "Maktab o'qituvchisi",
          "Oliy ta'lim o'qituvchisi / professor",
          "Bog'cha tarbiyachisi",
          "O'quv markazi o'qituvchisi / repetitor",
          "Ta'lim muassasasi rahbari / xodimi",
          'Talaba (OTM)',
          "Litsey / texnikum / kollej o'quvchisi",
          "Maktab o'quvchisi",
        ],
      },
      {
        code: 'TIBBIYOT',
        category: 'Tibbiyot va farmatsevtika',
        items: [
          'Shifokor (vrach)',
          'Hamshira / feldsher',
          'Stomatolog',
          'Farmatsevt / dorixona xodimi',
          'Kichik tibbiy xodim / laborant',
        ],
      },
      {
        code: 'BANK_MOLIYA',
        category: "Bank, moliya va to'lov tizimlari",
        items: [
          'Bank xodimi',
          "To'lov tashkiloti / fintex xodimi (Payme, Click, Uzum va b.)",
          'Buxgalter / auditor',
          'Iqtisodchi / moliyachi',
          "Sug'urta / mikromoliya xodimi",
        ],
      },
      {
        code: 'TADBIRKORLIK_SAVDO',
        category: 'Tadbirkorlik va savdo',
        items: [
          'Yakka tartibdagi tadbirkor (YaTT)',
          "Korxona / MChJ rahbari (ta'sischisi)",
          "Do'kon / bozor sotuvchisi",
          'Onlayn savdo / marketpleys sotuvchisi',
          'Savdo agenti / menejer',
          'Kassir / omborchi',
        ],
      },
      {
        code: 'IT_MEDIA',
        category: 'IT, telekommunikatsiya va media',
        items: [
          'Dasturchi / IT mutaxassisi',
          'Dizayner / SMM / marketolog',
          'Aloqa va telekommunikatsiya xodimi',
          'Bloger / jurnalist / OAV xodimi',
          'Frilanser',
        ],
      },
      {
        code: 'SANOAT_ENERGETIKA',
        category: 'Sanoat, energetika va neft-gaz',
        items: [
          'Neft-gaz sohasi xodimi',
          'Energetika / elektr tarmoqlari xodimi',
          'Zavod / fabrika ishchisi',
          'Muhandis / texnolog',
          'Tikuvchilik / yengil sanoat ishchisi',
        ],
      },
      {
        code: 'QURILISH_KOMMUNAL',
        category: 'Qurilish va kommunal soha',
        items: [
          "Quruvchi / usta (suvoqchi, g'isht teruvchi, bo'yoqchi va b.)",
          'Prorab / arxitektor / muhandis-quruvchi',
          'Elektrik / santexnik / payvandchi',
          'Kommunal xizmat xodimi (suv, gaz, obodonlashtirish)',
        ],
      },
      {
        code: 'TRANSPORT_LOGISTIKA',
        category: 'Transport va logistika',
        items: [
          'Taksi haydovchisi',
          'Yuk mashinasi / avtobus haydovchisi',
          'Kuryer / yetkazib beruvchi',
          "Temir yo'l / aviatsiya xodimi",
          'Avtoservis ustasi / mexanik',
        ],
      },
      {
        code: 'QISHLOQ_XOJALIGI',
        category: "Qishloq xo'jaligi va fermerlik",
        items: [
          "Fermer / dehqon xo'jaligi rahbari",
          'Dehqon / dala ishchisi',
          "Chorvador / bog'bon",
          'Agronom / veterinar',
        ],
      },
      {
        code: 'XIZMAT_KORSATISH',
        category: "Xizmat ko'rsatish va hunarmandchilik",
        items: [
          'Oshpaz / ofitsiant / umumiy ovqatlanish xodimi',
          "Sartarosh / go'zallik saloni ustasi",
          'Mehmonxona / turizm xodimi',
          "Qo'riqchi / xavfsizlik xodimi",
          "Hunarmand / ta'mirlovchi usta",
          "Boshqa xizmat ko'rsatish xodimi",
        ],
      },
      {
        code: 'NAFAQAXORLAR',
        category: "Nafaqaxo'rlar va ijtimoiy toifa",
        items: [
          "Yoshga doir nafaqaxo'r",
          "Nogironligi bo'lgan shaxs",
          "Boquvchisini yo'qotgan shaxs",
        ],
      },
      {
        code: 'VAQTINCHA_ISHSIZLAR',
        category: 'Vaqtincha ishsizlar va uy bekasi',
        items: [
          'Vaqtincha ishsiz',
          'Uy bekasi',
          'Mavsumiy / kunlik ishchi',
          'Xorijda ishlovchi (mehnat migranti)',
        ],
      },
      {
        code: 'CHET_EL_FUQAROLARI',
        category: 'Chet el fuqarolari',
        items: [
          'Sayyoh / chet el mehmoni',
          'Xorijiy kompaniya vakili / mutaxassisi',
          'Xorijiy talaba',
        ],
      },
    ];

    // 1. Yangi default toifalar va kasb turlarini yaratish / tartibini yangilash
    let order = 1;
    for (const group of initialData) {
      const cat = await this.createCategory({
        name: group.category,
        code: group.code,
        sort_order: order,
        is_active: true,
      });

      if (cat.sort_order !== order || cat.code !== group.code || !cat.is_active) {
        cat.sort_order = order;
        cat.code = group.code;
        cat.is_active = true;
        await this.categoryRepo.save(cat);
      }
      order++;

      let occOrder = 1;
      for (const itemName of group.items) {
        const occ = await this.createOccupation({
          category_id: cat.id,
          name: itemName,
          sort_order: occOrder,
          is_active: true,
        });

        if (occ.sort_order !== occOrder || !occ.is_active) {
          occ.sort_order = occOrder;
          occ.is_active = true;
          await this.occupationRepo.save(occ);
        }
        occOrder++;
      }
    }

    // 2. Eski (aralashib ketgan) default toifalarni xavfsiz tozalash:
    //    bog'lanmagan bo'lsa o'chiriladi, fuqarolar/ish joylariga bog'langan bo'lsa nofaol qilinadi.
    const legacyCategoryNames = [
      'Xususiy sektor tadbirkorlar',
      "To'lov tashkilotlari",
      "Ta'lim tashkilotlari",
      'Tibbiyot sohasidagi hodimlar',
      'Davlat korxona va tashkilotlar ishchilari',
      'HMQO organlari hodimlar',
      "Nafaqaxo'rlar",
      'Vaqtincha ishsizlar',
    ];

    for (const legacyName of legacyCategoryNames) {
      const legacyCat = await this.categoryRepo
        .createQueryBuilder('c')
        .where('LOWER(c.name) = LOWER(:name)', { name: legacyName })
        .getOne();
      if (!legacyCat) continue;

      const citizenRefs: Array<{ cnt: number }> = await this.categoryRepo.manager.query(
        `SELECT COUNT(*)::int AS cnt FROM citizens
         WHERE occupation_category_id = $1
            OR occupation_id IN (SELECT id FROM occupations WHERE category_id = $1)`,
        [legacyCat.id],
      );
      const workplaceRefs: Array<{ cnt: number }> = await this.categoryRepo.manager.query(
        `SELECT COUNT(*)::int AS cnt FROM workplaces WHERE occupation_category_id = $1`,
        [legacyCat.id],
      );
      const citizenRefCount = citizenRefs[0]?.cnt ?? 0;
      const workplaceRefCount = workplaceRefs[0]?.cnt ?? 0;

      if (citizenRefCount === 0 && workplaceRefCount === 0) {
        await this.categoryRepo.remove(legacyCat);
      } else {
        legacyCat.is_active = false;
        await this.categoryRepo.save(legacyCat);
        await this.occupationRepo.update({ category_id: legacyCat.id }, { is_active: false });
      }
    }

    // 3. "Chet el fuqarolari" ichidagi eski dublikat/ko'plikdagi yozuvlarni xavfsiz tozalash
    const foreignCat = await this.categoryRepo
      .createQueryBuilder('c')
      .where('LOWER(c.name) = LOWER(:name)', { name: 'Chet el fuqarolari' })
      .getOne();
    if (foreignCat) {
      const legacyForeignItems = [
        'Chet el fuqarolari',
        'Sayyohlar / Chet el mehmonlari',
        'Xorijiy kompaniya vakillari',
        'Xorijiy talabalar',
      ];
      for (const legacyItemName of legacyForeignItems) {
        const legacyOcc = await this.occupationRepo
          .createQueryBuilder('o')
          .where('o.category_id = :catId AND LOWER(o.name) = LOWER(:name)', {
            catId: foreignCat.id,
            name: legacyItemName,
          })
          .getOne();
        if (!legacyOcc) continue;

        const occRefs: Array<{ cnt: number }> = await this.occupationRepo.manager.query(
          `SELECT COUNT(*)::int AS cnt FROM citizens WHERE occupation_id = $1`,
          [legacyOcc.id],
        );
        const refCount = occRefs[0]?.cnt ?? 0;

        if (refCount === 0) {
          await this.occupationRepo.remove(legacyOcc);
        } else {
          legacyOcc.is_active = false;
          await this.occupationRepo.save(legacyOcc);
        }
      }
    }
  }
}
