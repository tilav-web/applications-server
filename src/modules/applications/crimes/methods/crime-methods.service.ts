import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Repository } from 'typeorm';

import { assertNoDependencies } from '../../../../common/database/dependency-guard.util';
import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { Crime } from '../crime.entity';
import { CrimeMethod } from './crime-method.entity';
import { CrimeMethodField } from './crime-method-field.entity';
import type { CreateCrimeMethodDto, CrimeMethodFieldDto } from './dto/create-crime-method.dto';
import type { UpdateCrimeMethodDto } from './dto/update-crime-method.dto';

/**
 * CyberControl (murojaat_shablon.xlsx -> Royxatlar D1:D28 va ID-lar) bilan 1-ga-1 mos 28 ta usul
 */
export const DEFAULT_CRIME_METHODS: Array<{
  code: string;
  name: string;
  group_name: string;
  sort_order: number;
}> = [
  {
    code: '1',
    name: "Soxta havola/zararli dastur orqali karta yoki qurilma boshqaruvini qo'lga kiritish",
    group_name: 'Fishing va karta/qurilma boshqaruvi',
    sort_order: 1,
  },
  {
    code: '2',
    name: "Soxta qo'ng'iroqlar orqali aldab, karta boshqaruvini qo'lga kiritish",
    group_name: 'Fishing va karta/qurilma boshqaruvi',
    sort_order: 2,
  },
  {
    code: '14',
    name: "Plastik kartasini yo'qotib qo'yishi oqibatida",
    group_name: 'Fishing va karta/qurilma boshqaruvi',
    sort_order: 3,
  },
  {
    code: '20',
    name: "Plastik kartasini yo'qotib qo'yishi oqibatida (bankomat)",
    group_name: 'Fishing va karta/qurilma boshqaruvi',
    sort_order: 4,
  },
  {
    code: '3',
    name: 'Ijtimoiy tarmoqlarda yoki onlayn savdo platformalarida sotuvchi yoki xaridor sifatida aldash',
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 5,
  },
  {
    code: '12',
    name: 'PUBG va boshqa internet akkauntlari orqali',
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 6,
  },
  {
    code: '17',
    name: "Ijtimoiy tarmoqlar (telegram, instagram) va o'yin akkauntini sotib olish uchun",
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 7,
  },
  {
    code: '10',
    name: 'Telegram akkauntlari orqali',
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 8,
  },
  {
    code: '15',
    name: 'Telefon savdosi orqali',
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 9,
  },
  {
    code: '13',
    name: "Ijaraga berish e'lonlari orqali",
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 10,
  },
  {
    code: '22',
    name: "Ijaraga xonadon topib berishni va'da qilib",
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 11,
  },
  {
    code: '18',
    name: "Chet elga ishga yoki o'qishga kiritishni va'da qilib",
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 12,
  },
  {
    code: '23',
    name: 'Haydovchilik guvohnomasi olib beraman deb',
    group_name: "Onlayn savdo, e'lonlar va akkauntlar",
    sort_order: 13,
  },
  {
    code: '4',
    name: "Soxta treiding yoki onlayn birjada pul ko'paytirish uchun o'tkazish",
    group_name: 'Treyding, investitsiya va yutuq aldovlari',
    sort_order: 14,
  },
  {
    code: '5',
    name: "Turli sohalarga investitsiya kiritish orqali pul ko'paytirib berish aldovlari",
    group_name: 'Treyding, investitsiya va yutuq aldovlari',
    sort_order: 15,
  },
  {
    code: '19',
    name: 'Aksiya yoki yutuq chiqqanligi bilan ishontirib',
    group_name: 'Treyding, investitsiya va yutuq aldovlari',
    sort_order: 16,
  },
  {
    code: '6',
    name: 'Onlayn mikro qarz va kredit rasmiylashtirish orqali',
    group_name: "Kredit, to'lov va bank tizimlari",
    sort_order: 17,
  },
  {
    code: '25',
    name: "Kredit, Kompensatsiya, moddiy yordam va boshqa to'lovlar chiqarib beraman deb aldash",
    group_name: "Kredit, to'lov va bank tizimlari",
    sort_order: 18,
  },
  {
    code: '26',
    name: "Kafil bo'lganligi yoki o'zining krediti uchun echib olgan",
    group_name: "Kredit, to'lov va bank tizimlari",
    sort_order: 19,
  },
  {
    code: '7',
    name: "Banklar va to'lov tashkilot xodimlari tizimga kirib, o'z mijozlari pulini o'zlashtirishi",
    group_name: "Kredit, to'lov va bank tizimlari",
    sort_order: 20,
  },
  {
    code: '8',
    name: "Banklar va to'lov tashkilotlari texnik zaifliklar yoki ularga bog'liq boshqa sabablar",
    group_name: "Kredit, to'lov va bank tizimlari",
    sort_order: 21,
  },
  {
    code: '24',
    name: "Telegram akkauntini boshqaruvini qo'lga kiritib tanishlaridan qarz so'rash",
    group_name: 'Ijtimoiy injiniring va soxta murojaatlar',
    sort_order: 22,
  },
  {
    code: '16',
    name: "O'zini korxona/tashkilot rahbari nomidan xodimlarga (feyk akk) topshiriq berish",
    group_name: 'Ijtimoiy injiniring va soxta murojaatlar',
    sort_order: 23,
  },
  {
    code: '11',
    name: "HMQO xodimlari nomidan yozish yoki qo'ng'iroq qilish",
    group_name: 'Ijtimoiy injiniring va soxta murojaatlar',
    sort_order: 24,
  },
  {
    code: '9',
    name: "Meros yoki pul yuborishni va'da qilish va xayriyalarga pul so'rash",
    group_name: 'Ijtimoiy injiniring va soxta murojaatlar',
    sort_order: 25,
  },
  {
    code: '21',
    name: 'Ijtimoiy tarmoqlardagi haqorat va tuhmat qilish holatlari (139/140...)',
    group_name: 'Boshqa holatlar',
    sort_order: 26,
  },
  {
    code: '27',
    name: "Noma'lum sharoit (aniqlanmoqda)",
    group_name: 'Boshqa holatlar',
    sort_order: 27,
  },
  {
    code: '28',
    name: "Boshqa yo'llar orqali",
    group_name: 'Boshqa holatlar',
    sort_order: 28,
  },
];

/**
 * Eski kirilldagi 16 ta standart usulni yangi 1-ga-1 usul kodiga ko'chirish xaritasi (dublikat qolmasligi uchun)
 */
const LEGACY_CYRILLIC_TO_CODE: Array<[string, string]> = [
  ['Сохта ҳавола/зарарли дастур орқали карта ёки қурилма бошқарувини қўлга киритиш орқали', '1'],
  ['Сохта қўнғироқлар орқали алдаб, карта бошқарувини қўлга киритиш орқали', '2'],
  [
    'Ижтимоий тармоқларда ёки онлайн савдо платформаларида “сотувчи” ёки “харидор” сифатида алдаш орқали',
    '3',
  ],
  ['Ишга, ўқишга киритиш, юбориш алдовлари орқали', '18'],
  ['ўқишга киритиш алдови орқали', '18'],
  ['Ишга киритиш алдови орқали', '18'],
  ['Сохта трейдинг ёки онлайн биржада пул кўпайтириш учун ўтказиш', '4'],
  ['Турли соҳаларга инвестиция киритиш орқали, пулини кўпайтириб бериш алдовлари орқали', '5'],
  ['Онлайн микро қарз ва кредит расмийлаштириш орқали', '6'],
  [
    'Банклар ва савдо платформалари (Узум ва б) лимит учун ажратилган пулларини алдаб, ўзлаштириш',
    '3',
  ],
  ['Банклар ва тўлов ташкилотлари техник заифликлари ёки уларга боғлиқ бошқа сабаблар бн', '8'],
  ['Банклар ва тўлов ташкилот ходимлари тизимга кириб, ўз мижозлари пулини ўзлаштриши', '7'],
  ['КРОСПАЙ', '28'],
  ['Танишлари номидан соҳта аккаунт ёрдамида пўл сўраш орқали', '24'],
  ['Мерос ёки пул, ютуқ юборишни ваъда қилиш ва хайрияларга пул сўраш шаклида', '9'],
  ['КОМПЕНСАЦИЯ ОЛИШ УЧУН ПУЛ СЎРАШ', '25'],
  ['Сунъий интеллект оркали расм, тасвир еки овозни сохталаштириб, фирибгарлик', '28'],
  ['Бошқа', '28'],
];

@Injectable()
export class CrimeMethodsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrimeMethodsService.name);

  constructor(
    @InjectRepository(CrimeMethod)
    private readonly repo: Repository<CrimeMethod>,
    @InjectRepository(CrimeMethodField)
    private readonly fieldRepo: Repository<CrimeMethodField>,
    @InjectRepository(Crime)
    private readonly crimeRepo: Repository<Crime>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const codeToEntity = new Map<string, CrimeMethod>();

      for (const item of DEFAULT_CRIME_METHODS) {
        let entity = await this.repo.findOne({ where: { name: ILike(item.name) } });
        if (!entity) {
          entity = await this.repo.save(
            this.repo.create({
              code: item.code,
              name: item.name,
              group_name: item.group_name,
              sort_order: item.sort_order,
              is_active: true,
            }),
          );
        } else {
          let changed = false;
          if (entity.name !== item.name) {
            entity.name = item.name;
            changed = true;
          }
          if (entity.group_name !== item.group_name) {
            entity.group_name = item.group_name;
            changed = true;
          }
          if (entity.code !== item.code) {
            entity.code = item.code;
            changed = true;
          }
          if (entity.sort_order !== item.sort_order) {
            entity.sort_order = item.sort_order;
            changed = true;
          }
          if (changed) {
            entity = await this.repo.save(entity);
          }
        }
        codeToEntity.set(item.code, entity);
      }

      // Eski kirilldagi standart yozuvlarni yangi 1-ga-1 yozuvlarga biriktirib tozalaymiz
      for (const [legacyName, targetCode] of LEGACY_CYRILLIC_TO_CODE) {
        const legacy = await this.repo.findOne({ where: { name: legacyName } });
        const target = codeToEntity.get(targetCode);
        if (legacy && target && legacy.id !== target.id) {
          await this.repo.manager.query(
            'UPDATE applications SET crime_method_id = $1 WHERE crime_method_id = $2',
            [target.id, legacy.id],
          );
          await this.repo.remove(legacy);
        }
      }

      this.logger.log(
        `Jinoyat sodir etish usullari CyberControl shabloni (${DEFAULT_CRIME_METHODS.length} ta) bilan sinxronlandi.`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`crime_methods bootstrap xatosi: ${msg}`);
    }
  }

  private slugifyFieldKey(label: string, index: number): string {
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    return slug ? `method_${slug}` : `method_field_${index + 1}`;
  }

  private sortMethodFields(item: CrimeMethod): CrimeMethod {
    if (Array.isArray(item.fields)) {
      item.fields.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return item;
  }

  async findAll(
    page = 1,
    limit = 50,
    search?: string,
    crimeId?: string,
  ): Promise<PaginatedResult<CrimeMethod>> {
    const qb = this.repo
      .createQueryBuilder('cm')
      .leftJoinAndSelect('cm.crimes', 'crime')
      .leftJoinAndSelect('cm.fields', 'field')
      .orderBy('cm.sort_order', 'ASC')
      .addOrderBy('cm.created_at', 'ASC')
      .addOrderBy('field.sort_order', 'ASC');

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      qb.andWhere('(cm.name ILIKE :q OR cm.group_name ILIKE :q OR cm.description ILIKE :q)', { q });
    }

    if (crimeId && crimeId.trim()) {
      // Ushbu jinoyat turiga bog'langan usullar YOKI hech bir jinoyat turiga bog'lanmagan (umumiy) usullar
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM crime_method_crimes cmc WHERE cmc.crime_method_id = cm.id AND cmc.crime_id = :crimeId)
          OR NOT EXISTS (SELECT 1 FROM crime_method_crimes cmc2 WHERE cmc2.crime_method_id = cm.id))`,
        { crimeId: crimeId.trim() },
      );
    }

    qb.skip((page - 1) * limit).take(limit);
    const [items, total] = await qb.getManyAndCount();
    items.forEach((it) => this.sortMethodFields(it));

    const totalPages = Math.ceil(total / limit) || 1;
    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async findAllActive(crimeId?: string): Promise<CrimeMethod[]> {
    const qb = this.repo
      .createQueryBuilder('cm')
      .leftJoinAndSelect('cm.crimes', 'crime')
      .leftJoinAndSelect('cm.fields', 'field', 'field.is_active = true')
      .where('cm.is_active = true')
      .orderBy('cm.sort_order', 'ASC')
      .addOrderBy('cm.created_at', 'ASC')
      .addOrderBy('field.sort_order', 'ASC');

    if (crimeId && crimeId.trim()) {
      // Tanlangan jinoyat turiga biriktirilgan usullar + hech bir turga bog'lanmagan umumiy usullar
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM crime_method_crimes cmc WHERE cmc.crime_method_id = cm.id AND cmc.crime_id = :crimeId)
          OR NOT EXISTS (SELECT 1 FROM crime_method_crimes cmc2 WHERE cmc2.crime_method_id = cm.id))`,
        { crimeId: crimeId.trim() },
      );
    }

    const items = await qb.getMany();
    return items.map((it) => this.sortMethodFields(it));
  }

  async findOne(id: string): Promise<CrimeMethod> {
    const item = await this.repo.findOne({
      where: { id },
      relations: { crimes: true, fields: true },
    });
    if (!item) {
      throw new NotFoundException(`Jinoyat usuli topilmadi: ${id}`);
    }
    return this.sortMethodFields(item);
  }

  private async syncMethodFields(
    methodId: string,
    fields: CrimeMethodFieldDto[],
    fieldRepo: Repository<CrimeMethodField> = this.fieldRepo,
  ): Promise<void> {
    await fieldRepo.delete({ crime_method_id: methodId });
    if (!fields || fields.length === 0) return;

    const usedKeys = new Set<string>();
    const entities = fields
      .filter((f) => f.label && f.label.trim().length > 0)
      .map((f, idx) => {
        let key = (f.key || '').trim() || this.slugifyFieldKey(f.label.trim(), idx);
        while (usedKeys.has(key)) {
          key = `${key}_${idx + 1}`;
        }
        usedKeys.add(key);

        return fieldRepo.create({
          crime_method_id: methodId,
          key,
          label: f.label.trim(),
          field_type: f.field_type || 'STRING',
          options: Array.isArray(f.options) && f.options.length > 0 ? f.options : null,
          placeholder: f.placeholder?.trim() || null,
          is_required: Boolean(f.is_required),
          show_in_excel: f.show_in_excel !== false,
          excel_header: f.excel_header?.trim() || f.label.trim(),
          sort_order: f.sort_order ?? idx,
          is_active: f.is_active !== false,
        });
      });

    if (entities.length > 0) {
      await fieldRepo.save(entities);
    }
  }

  async create(dto: CreateCrimeMethodDto): Promise<CrimeMethod> {
    const cleanName = dto.name.trim();
    const existing = await this.repo.findOne({ where: { name: ILike(cleanName) } });
    if (existing) {
      throw new BadRequestException(`"${cleanName}" usuli allaqachon mavjud`);
    }

    let linkedCrimes: Crime[] = [];
    if (dto.crime_ids && dto.crime_ids.length > 0) {
      linkedCrimes = await this.crimeRepo.findBy({ id: In(dto.crime_ids) });
    }

    const entity = this.repo.create({
      name: cleanName,
      group_name: (dto.group_name || 'Boshqa holatlar').trim(),
      code: dto.code ?? null,
      description: dto.description ?? null,
      sort_order: dto.sort_order ?? 0,
      is_active: dto.is_active ?? true,
      crimes: linkedCrimes,
    });

    const saved = await this.repo.save(entity);

    if (dto.fields && dto.fields.length > 0) {
      await this.syncMethodFields(saved.id, dto.fields);
    }

    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdateCrimeMethodDto): Promise<CrimeMethod> {
    const item = await this.findOne(id);

    if (dto.name) {
      const cleanName = dto.name.trim();
      if (cleanName !== item.name) {
        const existing = await this.repo.findOne({ where: { name: ILike(cleanName) } });
        if (existing && existing.id !== id) {
          throw new BadRequestException(`"${cleanName}" usuli allaqachon mavjud`);
        }
        item.name = cleanName;
      }
    }

    if (dto.group_name !== undefined) item.group_name = dto.group_name.trim();
    if (dto.code !== undefined) item.code = dto.code;
    if (dto.description !== undefined) item.description = dto.description;
    if (dto.sort_order !== undefined) item.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) item.is_active = dto.is_active;

    if (dto.crime_ids !== undefined) {
      item.crimes =
        dto.crime_ids.length > 0 ? await this.crimeRepo.findBy({ id: In(dto.crime_ids) }) : [];
    }

    await this.repo.manager.transaction(async (manager) => {
      const txRepo = manager.getRepository(CrimeMethod);
      const txFieldRepo = manager.getRepository(CrimeMethodField);
      await txRepo.save(item);
      if (dto.fields !== undefined) {
        await this.syncMethodFields(item.id, dto.fields, txFieldRepo);
      }
    });

    return this.findOne(item.id);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await assertNoDependencies(
      this.repo.manager,
      `«${item.name}» jinoyat sodir etish usuli`,
      item.id,
      [
        {
          table: 'applications',
          column: 'crime_method_id',
          label: 'ariza',
          extraWhere: 'is_deleted = false',
        },
        {
          table: 'detected_crimes',
          column: 'crime_method_id',
          label: 'aniqlangan jinoyat',
          extraWhere: 'is_deleted = false',
        },
      ],
    );
    await this.repo.remove(item);
    return { success: true, message: `Jinoyat usuli o‘chirildi: "${item.name}"` };
  }
}
