import PizZip from 'pizzip';

import { DocxEngineService } from './docx-engine.service';

function buildMinimalDocxBuffer(
  documentBodyXml: string,
  extraEntries?: Record<string, string>,
): Buffer {
  const zip = new PizZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${documentBodyXml}</w:body>
</w:document>`,
  );
  if (extraEntries) {
    for (const [k, v] of Object.entries(extraEntries)) {
      zip.file(k, v);
    }
  }
  return zip.generate({ type: 'nodebuffer' });
}

function readDocxText(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const xml = zip.file('word/document.xml')?.asText() || '';
  return xml.replace(/<[^>]+>/g, '').trim();
}

describe('DocxEngineService', () => {
  let service: DocxEngineService;

  beforeEach(() => {
    service = new DocxEngineService();
  });

  describe('renderTemplate', () => {
    it('renders flat keys, nested paths, loops, and replaces missing values with empty strings', () => {
      const tpl = buildMinimalDocxBuffer(
        `<w:p><w:r><w:t>Ariza: {{app_num}}, Fuqaro: {{citizen.full_name}}, Tuman: {{citizen.district.name}}, Yoq: {{missing.tag}}</w:t></w:r></w:p>
         <w:p><w:r><w:t>{{#items}}{{name}}-{{sum}}; {{/items}}</w:t></w:r></w:p>`,
      );

      const out = service.renderTemplate(tpl, {
        app_num: '2026-0001',
        citizen: { full_name: 'Ali Valiyev', district: { name: 'Qarshi sh.' } },
        items: [
          { name: 'Click', sum: 100 },
          { name: 'Payme', sum: 200 },
        ],
      });

      const text = readDocxText(out);
      expect(text).toContain('Ariza: 2026-0001, Fuqaro: Ali Valiyev, Tuman: Qarshi sh., Yoq: ');
      expect(text).toContain('Click-100; Payme-200;');
      expect(text).not.toContain('undefined');
    });

    it('blocks prototype pollution tag segments (__proto__, constructor, prototype)', () => {
      const tpl = buildMinimalDocxBuffer(
        `<w:p><w:r><w:t>A={{__proto__}}|B={{constructor.name}}|C={{citizen.prototype}}</w:t></w:r></w:p>`,
      );

      const out = service.renderTemplate(tpl, { citizen: { name: 'Test' } });
      expect(readDocxText(out)).toBe('A=|B=|C=');
    });

    it('rejects ZIP-bomb / excessive-entry archives (> 500 entries)', () => {
      const extra: Record<string, string> = {};
      for (let i = 0; i < 505; i++) {
        extra[`word/dummy_${i}.xml`] = '<x/>';
      }
      const hugeEntriesDocx = buildMinimalDocxBuffer('<w:p><w:r><w:t>Hi</w:t></w:r></w:p>', extra);

      expect(() => service.renderTemplate(hugeEntriesDocx, {})).toThrow(
        /ichki elementlar sonidan oshib ketdi/,
      );
    });
  });

  describe('extractTags & validateTemplate', () => {
    it('extracts tags split across multiple Word XML runs AND tags inside header/footer XML parts', () => {
      const tpl = buildMinimalDocxBuffer(
        `<w:p><w:r><w:t>{{citizen.</w:t></w:r><w:r><w:t>full_name}}</w:t></w:r><w:r><w:t> {{#transfers}}{{amount}}{{/transfers}}</w:t></w:r></w:p>`,
        {
          'word/header1.xml':
            '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{{header.date}}</w:t></w:r></w:p></w:hdr>',
          'word/footer1.xml':
            '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>{{footer.officer}}</w:t></w:r></w:p></w:ftr>',
        },
      );

      const tags = service.extractTags(tpl);
      expect(tags).toEqual(
        expect.arrayContaining([
          'citizen.full_name',
          'transfers',
          'amount',
          'header.date',
          'footer.officer',
        ]),
      );

      const validation = service.validateTemplate(tpl);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
      expect(validation.tags).toContain('citizen.full_name');
    });

    it('reports validation errors for broken template syntax or corrupted buffers', () => {
      const brokenTpl = buildMinimalDocxBuffer(
        '<w:p><w:r><w:t>Unclosed {{citizen.name</w:t></w:r></w:p>',
      );
      const resBroken = service.validateTemplate(brokenTpl);
      expect(resBroken.valid).toBe(false);
      expect(resBroken.errors.length).toBeGreaterThan(0);

      const resCorrupt = service.validateTemplate(Buffer.from('not-a-zip-file'));
      expect(resCorrupt.valid).toBe(false);
      expect(resCorrupt.errors.length).toBeGreaterThan(0);
    });
  });
});
