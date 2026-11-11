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
      .leftJoinAndSelect('cat.occupations', 'occ')
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
    if (data.category_id !== undefined) occ.category_id = data.category_id;
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

    return this.occupationRepo.save(occ);
  }

  async removeOccupation(id: string): Promise<{ success: boolean; message: string }> {
    const occ = await this.findOccupationById(id);
    await this.occupationRepo.remove(occ);
    return { success: true, message: "Kasb o'chirildi" };
  }

  // ==========================================================================
  // SEED DEFAULT OCCUPATIONS (from User Images)
  // ==========================================================================
  async seedDefaults(): Promise<void> {
    const count = await this.categoryRepo.count();
    if (count > 0) return;

    const initialData: { category: string; items: string[] }[] = [
      {
        category: 'Xususiy sektor tadbirkorlar',
        items: [
          "Savdo faoliyati bilan shug'ullanuvchilar",
          'Yirik korxona ishchi-xizmatchilar',
          'Kichik tashkilotlar ishchi-xizmatchilar',
          "Xizmat ko'rsatish sektori ishchilari",
        ],
      },
      {
        category: "To'lov tashkilotlari",
        items: [
          'Bank xodimlari',
          'To‘lov tizimi (Click/Payme/Uzum) mutaxassislari',
          'Moliya va kredit tashkilotlari xodimlari',
        ],
      },
      {
        category: "Ta'lim tashkilotlari",
        items: [
          'Maktab o‘qituvchilari',
          'Oliy ta’lim muassasalari professor-o‘qituvchilari',
          'Maktabgacha ta’lim muassasasi xodimlari',
          'Talabalar va o‘quvchilar',
        ],
      },
      {
        category: 'Tibbiyot sohasidagi hodimlar',
        items: ['Shifokorlar', 'Hamshira va kichik tibbiy xodimlar', 'Farmatsevtlar'],
      },
      {
        category: 'Davlat korxona va tashkilotlar ishchilari',
        items: [
          'Hokimiyat va davlat boshqaruvi xodimlari',
          'Kommunal soha xodimlari',
          'Sanoat va ishlab chiqarish davlat korxonalari xodimlari',
        ],
      },
      {
        category: 'HMQO organlari hodimlar',
        items: [
          'IIB xodimlari',
          'Harbiylar (Mudofaa)',
          'Favqulodda vaziyatlar xodimlari',
          'Boshqa huquq-tartibot organlari',
        ],
      },
      {
        category: "Nafaqaxo'rlar",
        items: [
          'Yoshga doir nafaqaxo‘rlar',
          'Nogironligi bo‘lgan shaxslar',
          'Boquvchisini yo‘qotganlar',
        ],
      },
      {
        category: 'Vaqtincha ishsizlar',
        items: ['Uy bekasi', 'Vaqtincha ishsiz fuqarolar', 'Mavsumiy ishchilar'],
      },
      {
        category: 'Chet el fuqarolari',
        items: [
          'Sayyohlar / Chet el mehmonlari',
          'Xorijiy kompaniya vakillari',
          'Xorijiy talabalar',
        ],
      },
    ];

    let order = 1;
    for (const group of initialData) {
      const cat = await this.createCategory({
        name: group.category,
        sort_order: order++,
      });
      let occOrder = 1;
      for (const itemName of group.items) {
        await this.createOccupation({
          category_id: cat.id,
          name: itemName,
          sort_order: occOrder++,
        });
      }
    }
  }
}
