'use client';

import { useState } from 'react';
import { Loader2, ArrowLeftRight, Copy, Check } from 'lucide-react';

export default function TranslationHelper() {
  const [direction, setDirection] = useState<'th-ko' | 'ko-th'>('th-ko');
  const [inputText, setInputText] = useState('');
  const [result, setResult] = useState('');
  const [translating, setTranslating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const placeholder =
    direction === 'th-ko' ? 'แปลข้อความภาษาไทย...' : '번역할 한국어를 입력하세요...';

  const handleTranslate = async () => {
    if (!inputText.trim()) return;
    setTranslating(true);
    setError('');
    setResult('');
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText, targetLang: direction === 'th-ko' ? 'ko' : 'th' }),
      });
      if (!res.ok) throw new Error('Translation failed');
      const data = await res.json();
      setResult(data.translated ?? '');
    } catch (e) {
      console.error('[TranslationHelper] translate error:', e);
      setError('번역 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setTranslating(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('[TranslationHelper] copy error:', e);
    }
  };

  const toggleDirection = () => {
    setDirection((d) => (d === 'th-ko' ? 'ko-th' : 'th-ko'));
    setInputText('');
    setResult('');
    setError('');
  };

  return (
    <div className="bg-gradient-to-r from-cyan-50/70 to-white rounded-xl shadow-sm border border-cyan-100 border-l-4 border-l-cyan-400 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-800">번역 도우미</h2>
        <button
          onClick={toggleDirection}
          className="flex items-center gap-1.5 text-sm text-cyan-700 bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 rounded-lg px-3 py-1.5 transition-colors"
        >
          <span>{direction === 'th-ko' ? '🇹🇭' : '🇰🇷'}</span>
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span>{direction === 'th-ko' ? '🇰🇷' : '🇹🇭'}</span>
        </button>
      </div>

      {/* Input */}
      <textarea
        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:border-transparent transition"
        rows={4}
        placeholder={placeholder}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
      />

      {/* Translate button */}
      <button
        onClick={handleTranslate}
        disabled={translating || !inputText.trim()}
        className="mt-3 w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-cyan-200 text-white text-sm font-medium rounded-lg px-4 py-2.5 transition-colors"
      >
        {translating ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            번역 중...
          </>
        ) : (
          '번역하기'
        )}
      </button>

      {/* Error */}
      {error && (
        <p className="mt-2 text-xs text-red-500">{error}</p>
      )}

      {/* Result */}
      {result && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-500">번역 결과</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-cyan-600 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-green-500">복사됨</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  복사
                </>
              )}
            </button>
          </div>
          <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 min-h-[80px] whitespace-pre-wrap">
            {result}
          </div>
        </div>
      )}
    </div>
  );
}
