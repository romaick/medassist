"""Import the supplied Belarus ICD-10 workbook without executing spreadsheet formulas."""
import argparse
import datetime
import hashlib
import json
import pathlib
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
SOURCE_PAGE = 'https://minzdrav.gov.by/ru/dlya-spetsialistov/klassifikatory/index.php'
SOURCE_FILE = 'https://minzdrav.gov.by/upload/dlya-spetsialistov/%D0%A1%D0%BF%D1%80%D0%B0%D0%B2%D0%BE%D1%87%D0%BD%D0%B8%D0%BA_%D0%9C%D0%9A%D0%91-10.xlsx'


def read_workbook(path):
    with zipfile.ZipFile(path) as book:
        if sum(item.file_size for item in book.infolist()) > 50 * 1024 * 1024:
            raise ValueError('Workbook expands beyond 50 MiB')
        strings = []
        if 'xl/sharedStrings.xml' in book.namelist():
            root = ET.fromstring(book.read('xl/sharedStrings.xml'))
            strings = [''.join(node.itertext()) for node in root.findall('s:si', NS)]
        links = {node.attrib['Id']: node.attrib['Target'] for node in ET.fromstring(book.read('xl/_rels/workbook.xml.rels'))}
        sheets = {}
        for sheet in ET.fromstring(book.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS):
            target = links[sheet.attrib['{' + REL + '}id']]
            location = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
            rows = []
            for row in ET.fromstring(book.read(location)).findall('s:sheetData/s:row', NS):
                cells = {}
                for cell in row.findall('s:c', NS):
                    if cell.find('s:f', NS) is not None:
                        raise ValueError('Unexpected formula in reference workbook')
                    raw = cell.find('s:v', NS)
                    kind = cell.attrib.get('t')
                    if kind == 's':
                        value = strings[int(raw.text)] if raw is not None else ''
                    elif kind == 'inlineStr':
                        value = ''.join(cell.find('s:is', NS).itertext())
                    else:
                        value = raw.text if raw is not None else ''
                    if value:
                        cells[re.sub(r'\d', '', cell.attrib['r'])] = value
                if cells:
                    rows.append(cells)
            sheets[sheet.attrib['name']] = rows
        return sheets


def import_catalog(source, checked_at):
    datetime.date.fromisoformat(checked_at)
    sheets = read_workbook(source)
    rows = sheets['Справочные данные']
    if rows[0] != {'A': 'Код', 'B': 'Наименование', 'C': 'Поле сортировки', 'D': 'Родительская запись', 'E': 'Код родительской записи', 'F': 'Иерархический уровень записи'}:
        raise ValueError('Unexpected reference columns; review the new workbook before import')
    passport = {row['A']: row.get('B', '') for row in sheets['Паспорт'] if 'A' in row}
    version = passport['Номер версии']
    if passport['Основной код'] != 'InternClassificDiseases10' or not version:
        raise ValueError('Unexpected classifier identity or missing version')
    codes = set()
    entries = []
    excluded = []
    for row in rows[1:]:
        code, display = row['A'], row['B']
        if code in codes:
            raise ValueError('Duplicate source code: ' + code)
        codes.add(code)
        prefix = code + ' - '
        if not display.startswith(prefix) or not display[len(prefix):].strip():
            raise ValueError('Unexpected source title for ' + code)
        if re.fullmatch(r'[IVX]+|[A-Z][0-9]{2}-[A-Z][0-9]{2}', code):
            excluded.append(code)
            continue
        if not re.fullmatch(r'[A-Z][0-9]{2}(?:\.[0-9]{1,4})?[A-Z]?', code):
            raise ValueError('Unrecognized code; review instead of silently removing it: ' + code)
        entry = {'code': code, 'title': display[len(prefix):], 'kind': 'subcategory' if '.' in code else 'category'}
        if '.' in code and row.get('E') and row.get('D'):
            parent_prefix = row['E'] + ' - '
            if not row['D'].startswith(parent_prefix):
                raise ValueError('Unexpected parent title for ' + code)
            entry['parent'] = {'code': row['E'], 'title': row['D'][len(parent_prefix):]}
        entries.append(entry)
    metadata = {
        'classification': 'МКБ-10',
        'release': 'Версия ' + version,
        'publisher': 'Министерство здравоохранения Республики Беларусь',
        'sourceUrl': SOURCE_PAGE,
        'checkedAt': checked_at,
        'note': 'Копия загруженного справочника. Названия и коды сохранены; классы и диапазоны кодов исключены из выбора. Диагноз и нужную детализацию выбирает врач. Полные правила кодирования здесь не представлены.'
    }
    provenance = {
        'sourcePage': SOURCE_PAGE, 'sourceFileUrl': SOURCE_FILE,
        'sourceFileSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'sourceBytes': source.stat().st_size,
        'sourceAcquisition': 'Файл по указанной ссылке предоставлен пользователем; независимая повторная загрузка с сайта в среде разработки не удалась.',
        'sourceVersion': version, 'checkedAt': checked_at,
        'sourceDataSheet': 'Справочные данные', 'sourceMetadataSheet': 'Паспорт',
        'sourceRowsExcludingHeader': len(rows) - 1, 'includedEntries': len(entries),
        'excludedClassAndRangeCodes': excluded,
        'letterSuffixEntries': sum(bool(re.search(r'[A-Z]$', entry['code'])) for entry in entries),
        'titlesWithCodingReferences': sum(bool(re.search(r'[*†‡+]', entry['title'])) for entry in entries),
        'transformation': 'Only remove the exact CODE + space-hyphen-space prefix from display; preserve remaining title and source code verbatim. Subcategory parent context comes verbatim from source parent columns. No inferred aliases, ancestry or clinical coding rules.'
    }
    return {'metadata': metadata, 'entries': entries}, provenance


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('--checked-at', required=True, help='Date of source verification, YYYY-MM-DD')
    args = parser.parse_args()
    catalog, provenance = import_catalog(args.source, args.checked_at)
    folder = pathlib.Path(__file__).resolve().parent.parent / 'medassist' / 'icd'
    folder.mkdir(exist_ok=True)
    (folder / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (folder / 'source.json').write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'entries': len(catalog['entries']), 'version': provenance['sourceVersion'], 'sha256': provenance['sourceFileSha256']}, ensure_ascii=True))
