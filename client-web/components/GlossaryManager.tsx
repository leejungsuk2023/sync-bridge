'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Upload, Search, Plus, Pencil, Trash2, FileSpreadsheet, X, Check, ChevronDown } from 'lucide-react';

interface GlossaryEntry {
  id: string;
  korean: string;
  thai: string;
  category: string;
  notes: string;
}

interface GlossaryManagerProps {
  userId: string;
}

interface ParsedEntry {
  korean: string;
  thai: string;
  category: string;
  notes: string;
}

const ITEMS_PER_PAGE = 20;

function parseCSV(text: string): ParsedEntry[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return []; // header + at least 1 row

  const parseLine = (line: string) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue; }
      current += char;
    }
    result.push(current.trim());
    return result;
  };

  const header = parseLine(lines[0]).map(h => h.toLowerCase());
  const korIdx = header.findIndex(h => h.includes('korean') || h.includes('한국어') || h === 'ko');
  const thIdx = header.findIndex(h => h.includes('thai') || h.includes('태국어') || h === 'th');
  const catIdx = header.findIndex(h => h.includes('category') || h.includes('카테고리'));
  const noteIdx = header.findIndex(h => h.includes('note') || h.includes('메모'));

  if (korIdx < 0 || thIdx < 0) return [];

  return lines.slice(1).map(line => {
    const cols = parseLine(line);
    return {
      korean: cols[korIdx] || '',
      thai: cols[thIdx] || '',
      category: catIdx >= 0 ? (cols[catIdx] || 'general') : 'general',
      notes: noteIdx >= 0 ? (cols[noteIdx] || '') : '',
    };
  }).filter(e => e.korean && e.thai);
}

export default function GlossaryManager({ userId }: GlossaryManagerProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [entries, setEntries] = useState<GlossaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);

  // Add entry state
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<ParsedEntry>({ korean: '', thai: '', category: 'general', notes: '' });
  const [addLoading, setAddLoading] = useState(false);

  // Edit state
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ParsedEntry>({ korean: '', thai: '', category: '', notes: '' });
  const [editLoading, setEditLoading] = useState(false);

  // CSV upload state
  const [showUpload, setShowUpload] = useState(false);
  const [csvEntries, setCsvEntries] = useState<ParsedEntry[]>([]);
  const [csvDuplicates, setCsvDuplicates] = useState(0);
  const [csvUploading, setCsvUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete state
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  const getAuthHeader = async () => {
    const session = (await supabase.auth.getSession()).data.session;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
    };
  };

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch('/api/glossary', {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.glossary || []);
      } else {
        console.error('[GlossaryManager] Failed to fetch entries:', res.status);
      }
    } catch (err) {
      console.error('[GlossaryManager] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // Categories derived from entries
  const categories = Array.from(new Set(entries.map(e => e.category))).sort();

  // Category counts
  const categoryCounts: Record<string, number> = {};
  entries.forEach(e => {
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
  });

  // Filtered entries
  const filtered = entries.filter(e => {
    const matchSearch = !search ||
      e.korean.toLowerCase().includes(search.toLowerCase()) ||
      e.thai.toLowerCase().includes(search.toLowerCase());
    const matchCategory = !categoryFilter || e.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  // Pagination
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [search, categoryFilter]);

  // CSV file handling
  const handleCSVFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        alert('CSV 파일을 파싱할 수 없습니다. korean/thai 컬럼이 필요합니다.');
        return;
      }
      // Check duplicates against existing entries
      const existingKeys = new Set(entries.map(e => `${e.korean}|${e.thai}`));
      let dupes = 0;
      parsed.forEach(p => {
        if (existingKeys.has(`${p.korean}|${p.thai}`)) dupes++;
      });
      setCsvEntries(parsed);
      setCsvDuplicates(dupes);
      setShowUpload(true);
    };
    reader.onerror = () => {
      console.error('[GlossaryManager] Failed to read file');
      alert('파일을 읽을 수 없습니다.');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleCSVFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleCSVFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const uploadCSV = async () => {
    try {
      setCsvUploading(true);
      const headers = await getAuthHeader();
      const res = await fetch('/api/glossary', {
        method: 'POST',
        headers,
        body: JSON.stringify({ entries: csvEntries }),
      });
      if (res.ok) {
        const data = await res.json();
        setShowUpload(false);
        setCsvEntries([]);
        setCsvDuplicates(0);
        await fetchEntries();
      } else {
        const err = await res.text();
        console.error('[GlossaryManager] CSV upload failed:', err);
        alert('업로드 실패: ' + err);
      }
    } catch (err) {
      console.error('[GlossaryManager] CSV upload error:', err);
      alert('업로드 중 오류가 발생했습니다.');
    } finally {
      setCsvUploading(false);
    }
  };

  // Add single entry
  const handleAdd = async () => {
    if (!addForm.korean || !addForm.thai) return;
    try {
      setAddLoading(true);
      const headers = await getAuthHeader();
      const res = await fetch('/api/glossary', {
        method: 'POST',
        headers,
        body: JSON.stringify({ entries: [addForm] }),
      });
      if (res.ok) {
        setShowAdd(false);
        setAddForm({ korean: '', thai: '', category: 'general', notes: '' });
        await fetchEntries();
      } else {
        alert('추가 실패');
      }
    } catch (err) {
      console.error('[GlossaryManager] Add error:', err);
    } finally {
      setAddLoading(false);
    }
  };

  // Edit entry
  const startEdit = (entry: GlossaryEntry) => {
    setEditId(entry.id);
    setEditForm({ korean: entry.korean, thai: entry.thai, category: entry.category, notes: entry.notes });
  };

  const handleEdit = async () => {
    if (!editId || !editForm.korean || !editForm.thai) return;
    try {
      setEditLoading(true);
      const headers = await getAuthHeader();
      const res = await fetch('/api/glossary', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ id: editId, ...editForm }),
      });
      if (res.ok) {
        setEditId(null);
        await fetchEntries();
      } else {
        alert('수정 실패');
      }
    } catch (err) {
      console.error('[GlossaryManager] Edit error:', err);
    } finally {
      setEditLoading(false);
    }
  };

  // Delete entry
  const handleDelete = async (id: string) => {
    if (!confirm('이 용어를 삭제하시겠습니까?')) return;
    try {
      setDeleteLoading(id);
      const headers = await getAuthHeader();
      const res = await fetch(`/api/glossary?id=${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        await fetchEntries();
      } else {
        alert('삭제 실패');
      }
    } catch (err) {
      console.error('[GlossaryManager] Delete error:', err);
    } finally {
      setDeleteLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-amber-50/70 to-white rounded-xl shadow-sm border border-amber-100 border-l-4 border-l-amber-400 p-6">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between cursor-pointer mb-0"
      >
        <div>
          <h2 className="text-lg font-semibold text-slate-900 text-left">용어집 관리</h2>
          <p className="text-xs text-slate-500 mt-1 text-left">한국어-태국어 의료/비즈니스 용어집을 관리합니다.</p>
        </div>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform shrink-0 ${collapsed ? '' : 'rotate-180'}`} />
      </button>
      {!collapsed && (<div className="space-y-4 mt-6">
      {/* Stats Bar */}
      <div className="bg-white rounded-lg border p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-gray-800">총 {entries.length}개 용어</span>
        </div>
        <div className="text-sm text-gray-500 flex flex-wrap gap-2">
          {categories.map(cat => (
            <span key={cat} className="bg-gray-100 px-2 py-0.5 rounded text-xs">
              {cat} {categoryCounts[cat]}
            </span>
          ))}
        </div>
      </div>

      {/* Actions Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="한국어 또는 태국어로 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Category Filter */}
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="">전체 카테고리</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{cat} ({categoryCounts[cat]})</option>
          ))}
        </select>

        {/* Add Button */}
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 px-3 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 transition"
        >
          <Plus className="w-4 h-4" />
          추가
        </button>

        {/* CSV Upload Button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1 px-3 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition"
        >
          <Upload className="w-4 h-4" />
          CSV 업로드
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* CSV Upload Preview */}
      {showUpload && csvEntries.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-blue-800">CSV 미리보기</h3>
            <button onClick={() => { setShowUpload(false); setCsvEntries([]); }} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="text-sm text-blue-700">
            새 항목: <span className="font-bold">{csvEntries.length - csvDuplicates}개</span>
            {csvDuplicates > 0 && (
              <> | 중복: <span className="font-bold text-orange-600">{csvDuplicates}개</span></>
            )}
            {' '}| 총: {csvEntries.length}개
          </div>
          <div className="max-h-48 overflow-y-auto border rounded bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 text-left text-gray-600 font-medium">한국어</th>
                  <th className="px-3 py-1.5 text-left text-gray-600 font-medium">ไทย</th>
                  <th className="px-3 py-1.5 text-left text-gray-600 font-medium">카테고리</th>
                  <th className="px-3 py-1.5 text-left text-gray-600 font-medium">메모</th>
                </tr>
              </thead>
              <tbody>
                {csvEntries.slice(0, 50).map((entry, i) => (
                  <tr key={i} className="border-t">
                    <td className="px-3 py-1.5">{entry.korean}</td>
                    <td className="px-3 py-1.5">{entry.thai}</td>
                    <td className="px-3 py-1.5 text-gray-500">{entry.category}</td>
                    <td className="px-3 py-1.5 text-gray-500">{entry.notes}</td>
                  </tr>
                ))}
                {csvEntries.length > 50 && (
                  <tr className="border-t">
                    <td colSpan={4} className="px-3 py-1.5 text-center text-gray-400">
                      ... 외 {csvEntries.length - 50}개
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowUpload(false); setCsvEntries([]); }}
              className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={uploadCSV}
              disabled={csvUploading}
              className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-1"
            >
              {csvUploading ? '업로드 중...' : '업로드'}
            </button>
          </div>
        </div>
      )}

      {/* Drag & Drop Zone (shown when no CSV is being previewed) */}
      {!showUpload && (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-4 text-center text-sm transition ${
            dragOver ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-400'
          }`}
        >
          CSV 파일을 여기에 드래그하세요
        </div>
      )}

      {/* Add Entry Form */}
      {showAdd && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-green-800">새 용어 추가</h3>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input
              type="text"
              placeholder="한국어 *"
              value={addForm.korean}
              onChange={e => setAddForm(f => ({ ...f, korean: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            <input
              type="text"
              placeholder="ไทย *"
              value={addForm.thai}
              onChange={e => setAddForm(f => ({ ...f, thai: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            <input
              type="text"
              placeholder="카테고리"
              value={addForm.category}
              onChange={e => setAddForm(f => ({ ...f, category: e.target.value }))}
              list="category-list"
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            <datalist id="category-list">
              {categories.map(cat => <option key={cat} value={cat} />)}
            </datalist>
            <input
              type="text"
              placeholder="메모 (선택)"
              value={addForm.notes}
              onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowAdd(false)}
              className="px-4 py-1.5 text-sm border rounded-lg hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={handleAdd}
              disabled={addLoading || !addForm.korean || !addForm.thai}
              className="px-4 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-1"
            >
              {addLoading ? '추가 중...' : <><Check className="w-4 h-4" /> 추가</>}
            </button>
          </div>
        </div>
      )}

      {/* Glossary Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">한국어</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">ไทย</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">카테고리</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">메모</th>
                <th className="px-4 py-3 text-right text-gray-600 font-medium">작업</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    {search || categoryFilter ? '검색 결과가 없습니다.' : '등록된 용어가 없습니다.'}
                  </td>
                </tr>
              ) : (
                paginated.map(entry => (
                  <tr key={entry.id} className="border-t hover:bg-gray-50">
                    {editId === entry.id ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.korean}
                            onChange={e => setEditForm(f => ({ ...f, korean: e.target.value }))}
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.thai}
                            onChange={e => setEditForm(f => ({ ...f, thai: e.target.value }))}
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.category}
                            onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                            list="category-list-edit"
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <datalist id="category-list-edit">
                            {categories.map(cat => <option key={cat} value={cat} />)}
                          </datalist>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={editForm.notes}
                            onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                            className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </td>
                        <td className="px-4 py-2 text-right space-x-1">
                          <button
                            onClick={handleEdit}
                            disabled={editLoading}
                            className="text-green-500 hover:text-green-700 p-1"
                            title="저장"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditId(null)}
                            className="text-gray-400 hover:text-gray-600 p-1"
                            title="취소"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 font-medium">{entry.korean}</td>
                        <td className="px-4 py-2.5">{entry.thai}</td>
                        <td className="px-4 py-2.5">
                          <span className="bg-gray-100 px-2 py-0.5 rounded text-xs text-gray-600">{entry.category}</span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{entry.notes}</td>
                        <td className="px-4 py-2.5 text-right space-x-1">
                          <button
                            onClick={() => startEdit(entry)}
                            className="text-blue-500 hover:text-blue-700 p-1"
                            title="수정"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            disabled={deleteLoading === entry.id}
                            className="text-red-400 hover:text-red-600 p-1"
                            title="삭제"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
            <span className="text-sm text-gray-500">
              {filtered.length}개 중 {(page - 1) * ITEMS_PER_PAGE + 1}-{Math.min(page * ITEMS_PER_PAGE, filtered.length)}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-40"
              >
                이전
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`px-3 py-1 text-sm border rounded ${
                      page === pageNum ? 'bg-blue-500 text-white border-blue-500' : 'hover:bg-gray-100'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 text-sm border rounded hover:bg-gray-100 disabled:opacity-40"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
      </div>)}
    </div>
  );
}
