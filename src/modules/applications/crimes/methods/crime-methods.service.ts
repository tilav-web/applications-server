import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';

import type { PaginatedResult } from '../../../../common/interfaces/pagination.interface';
import { CrimeMethod } from './crime-method.entity';
import type { CreateCrimeMethodDto } from './dto/create-crime-method.dto';
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

  async findAll(page = 1, limit = 50, search?: string): Promise<PaginatedResult<CrimeMethod>> {
    const where: FindOptionsWhere<CrimeMethod>[] = [];

    if (search && search.trim()) {
      const q = search.trim();
      where.push(
        { name: ILike(`%${q}%`) },
        { group_name: ILike(`%${q}%`) },
        { description: ILike(`%${q}%`) },
      );
    }

    const [items, total] = await this.repo.findAndCount({
      where: where.length > 0 ? where : undefined,
      order: { sort_order: 'ASC', created_at: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

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

  async findAllActive(): Promise<CrimeMethod[]> {
    return this.repo.find({
      where: { is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
  }

  async findOne(id: string): Promise<CrimeMethod> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException(`Jinoyat usuli topilmadi: ${id}`);
    }
    return item;
  }

  async create(dto: CreateCrimeMethodDto): Promise<CrimeMethod> {
    const cleanName = dto.name.trim();
    const existing = await this.repo.findOne({ where: { name: ILike(cleanName) } });
    if (existing) {
      throw new BadRequestException(`"${cleanName}" usuli allaqachon mavjud`);
    }

    const entity = this.repo.create({
      ...dto,
      name: cleanName,
      group_name: (dto.group_name || 'Boshqa holatlar').trim(),
      sort_order: dto.sort_order ?? 0,
      is_active: dto.is_active ?? true,
    });

    return this.repo.save(entity);
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

    return this.repo.save(item);
  }

  async remove(id: string): Promise<{ success: boolean; message: string }> {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { success: true, message: `Jinoyat usuli o‘chirildi: "${item.name}"` };
  }
}
