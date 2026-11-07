import { computed, ref, watch } from 'vue';

/** Rows per page the tables of the portal offer, the first by default. */
export const PAGE_SIZES = [25, 50, 100, 200] as const;
export const PAGE_SIZE = PAGE_SIZES[0];

const PAGE_SIZE_KEY = 'amw-admin-page-size';

// A convenience of this browser only: storage may be blocked, then the default applies
function storedPageSize(): number {
  try {
    const stored = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : PAGE_SIZE;
  } catch {
    return PAGE_SIZE;
  }
}

/**
 * Searches and pages through rows already in the browser. A new list (period, sort, site,
 * refresh), search or page size starts again from the first page, as the old position no longer
 * means anything.
 * @param text The values of a row the search looks into.
 */
export function usePagination<T>(items: () => T[], text: (item: T) => (string | null | undefined)[] = () => []) {
  const page = ref(1);
  const query = ref('');
  const pageSize = ref(storedPageSize());

  const filtered = computed(() => {
    const terms = query.value.trim().toLowerCase();
    if (!terms) return items();
    return items().filter(item => text(item).some(value => value?.toLowerCase().includes(terms)));
  });
  const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
  const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));

  watch([items, query, pageSize], () => { page.value = 1; });
  watch(pageSize, size => {
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(size));
    } catch {
      // Not remembered, the table still works
    }
  });

  return { page, pageCount, visible, pageSize, query, filtered };
}

type Cell = string | number | null | undefined;

/**
 * Titles come from Amazon and URLs from a client-controlled Referer: a cell starting with one
 * of these characters would run as a formula once opened in a spreadsheet. Numbers are safe.
 */
function csvCell(value: Cell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** RFC 4180 CSV. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, csv: string): void {
  // The byte order mark makes Excel read the file as UTF-8
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
