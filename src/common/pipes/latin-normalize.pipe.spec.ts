import { LatinNormalizePipe } from './latin-normalize.pipe';

describe('LatinNormalizePipe', () => {
  let pipe: LatinNormalizePipe;

  beforeEach(() => {
    pipe = new LatinNormalizePipe();
  });

  it('converts Cyrillic text in request body recursively', () => {
    const input = {
      first_name: 'Сардор',
      last_name: 'Ғаниев',
      description: 'Фуқаро Ғузор туманида фирибгарликка учраган',
      passport: 'аа1234567',
      suspect_tree: [
        {
          label: 'Телеграм аккаунт',
          value: 'https://t.me/test_user',
          children: [{ label: 'Изоҳ', value: 'Сохта банк ходими' }],
        },
      ],
    };

    const output = pipe.transform(input, { type: 'body' }) as Record<string, unknown>;

    expect(output.first_name).toBe('Sardor');
    expect(output.last_name).toBe("G'aniyev");
    expect(output.description).toBe("Fuqaro G'uzor tumanida firibgarlikka uchragan");
    expect(output.passport).toBe('AA1234567');
    expect(output.suspect_tree).toEqual([
      {
        label: 'Telegram akkaunt',
        value: 'https://t.me/test_user',
        children: [{ label: 'Izoh', value: 'Soxta bank xodimi' }],
      },
    ]);
  });

  it('converts Cyrillic search query params to Latin', () => {
    const query = { search: 'Ғузор', page: '1' };
    const output = pipe.transform(query, { type: 'query' }) as Record<string, unknown>;
    expect(output.search).toBe("G'uzor");
    expect(output.page).toBe('1');
  });

  it('preserves excluded fields (passwords, tokens, file keys, title_krill, emails, URLs, UUIDs)', () => {
    const input = {
      password: 'Пароль123!',
      current_password: 'ЭскиПароль1!',
      new_password: 'ЯнгиПароль2!',
      key: 'attachments/2026_Ариза.pdf',
      bot_token: '123456:ABC-DEF_Кирилл',
      username: 'админ_тест',
      title_krill: 'Тушунтириш хати',
      script: 'krill',
      url: 'https://example.com/путь',
      email: 'user@example.com',
      id: '550e8400-e29b-41d4-a716-446655440000',
    };

    const output = pipe.transform(input, { type: 'body' }) as Record<string, unknown>;
    expect(output).toEqual(input);

    const queryKey = pipe.transform('attachments/Ариза.pdf', { type: 'query', data: 'key' });
    expect(queryKey).toBe('attachments/Ариза.pdf');
  });

  it('skips custom decorator metadata', () => {
    const userObj = { full_name: 'Админ' };
    expect(pipe.transform(userObj, { type: 'custom' })).toBe(userObj);
  });
});
