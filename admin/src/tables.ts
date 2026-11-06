import { computed, ref, watch } from 'vue';

/** Rows shown per page in the tables of the portal. */
export const PAGE_SIZE = 25;

/**
 * Pages through rows already in the browser. A new list (period, sort, site, refresh) starts
 * again from the first page, as the old position no longer means anything.
 */
export function usePagination<T>(items: () => T[], pageSize: number = PAGE_SIZE) {
  const page = ref(1);
  const pageCount = computed(() => Math.max(1, Math.ceil(items().length / pageSize)));
  const visible = computed(() => items().slice((page.value - 1) * pageSize, page.value * pageSize));

  watch(items, () => { page.value = 1; });

  return { page, pageCount, visible, pageSize };
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
