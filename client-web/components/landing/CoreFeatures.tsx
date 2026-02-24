'use client';

import { motion } from 'framer-motion';
import { Monitor, Languages, Shield, Eye, CheckCircle2, Clock } from 'lucide-react';

export function CoreFeatures() {
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">SyncBridge 핵심 기능</h2>
          <p className="text-xl text-gray-600">재택이지만 진료실 옆자리처럼 투명하게</p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6 max-w-6xl mx-auto">
          {/* Block 1 - 투명한 실시간 관제 */}
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
            className="lg:row-span-2 bg-gradient-to-br from-blue-50 to-blue-100 rounded-3xl p-8 lg:p-10 border-2 border-blue-200 hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-400/20 to-transparent rounded-full blur-3xl"></div>
            <div className="relative z-10">
              <div className="w-16 h-16 bg-gradient-to-br from-[#004EE6] to-[#0066FF] rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Monitor className="w-8 h-8 text-white" />
              </div>
              <h3 className="text-3xl font-bold mb-4 text-gray-900">투명한 실시간 관제</h3>
              <p className="text-lg text-gray-700 mb-8 leading-relaxed">출퇴근부터 업무 진행 상황까지 100% 투명하게 모니터링. 원격 근무의 불안함을 완전히 제거합니다.</p>

              <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-[#004EE6] to-[#0066FF] px-4 py-3 flex items-center justify-between">
                  <span className="text-white font-semibold text-sm">업무 현황</span>
                  <div className="flex items-center gap-2"><div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div><span className="text-white text-xs">실시간</span></div>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                    <Eye className="w-5 h-5 text-blue-600" />
                    <div className="flex-1"><div className="text-sm font-semibold text-gray-900">환자 상담 응대</div><div className="text-xs text-gray-500">진행중 · 14:32</div></div>
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  </div>
                  <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <Clock className="w-5 h-5 text-orange-600" />
                    <div className="flex-1"><div className="text-sm font-semibold text-gray-900">카드뉴스 제작</div><div className="text-xs text-gray-500">마감 17:00</div></div>
                    <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-semibold">검수중</span>
                  </div>
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-600">오늘의 진행률</span>
                      <span className="text-xs font-bold text-[#004EE6]">78%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <motion.div initial={{ width: 0 }} whileInView={{ width: '78%' }} viewport={{ once: true }} transition={{ duration: 1, delay: 0.5 }}
                        className="bg-gradient-to-r from-[#004EE6] to-[#0066FF] h-2 rounded-full"></motion.div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                {['접속 상태 실시간 확인', '업무별 진행 단계 추적', '마감 시간 자동 알림'].map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-green-600" /><span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Block 2 - 언어 장벽 Zero */}
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
            className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-3xl p-8 border-2 border-purple-200 hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-purple-400/20 to-transparent rounded-full blur-3xl"></div>
            <div className="relative z-10">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-600 to-purple-700 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Languages className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-bold mb-3 text-gray-900">언어 장벽 Zero</h3>
              <p className="text-gray-700 mb-6 leading-relaxed">의료 특화 자동 번역으로 시술 용어를 정확하게 전달. 오역 리스크를 원천 차단합니다.</p>

              <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="flex justify-end">
                    <div className="bg-[#004EE6] text-white px-4 py-2 rounded-2xl rounded-tr-sm max-w-[80%]">
                      <p className="text-sm">보톡스 시술 안내해주세요</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-px bg-gray-300 flex-1"></div>
                    <Languages className="w-4 h-4 text-purple-600" />
                    <span className="text-xs text-gray-500">자동 번역</span>
                    <div className="h-px bg-gray-300 flex-1"></div>
                  </div>
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-2xl rounded-tl-sm max-w-[80%]">
                      <p className="text-sm">กรุณาให้ข้อมูลการฉีดโบท็อกซ์</p>
                      <p className="text-xs text-gray-500 mt-1">✓ 의료 용어 DB 검증됨</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                {['성형/피부과 전용 용어 DB', '응대 지연 Zero'].map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-green-600" /><span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Block 3 - 한국인 PM */}
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-green-50 to-green-100 rounded-3xl p-8 border-2 border-green-200 hover:shadow-2xl transition-all group relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 bg-gradient-to-br from-green-400/20 to-transparent rounded-full blur-3xl"></div>
            <div className="relative z-10">
              <div className="w-14 h-14 bg-gradient-to-br from-green-600 to-green-700 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Shield className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-2xl font-bold mb-3 text-gray-900">한국인 PM 밀착 코칭</h3>
              <p className="text-gray-700 mb-6 leading-relaxed">의료 사고를 막는 2차 검수. 한국인 매니저가 응대 품질을 실시간 모니터링하고 코칭합니다.</p>

              <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
                <div className="space-y-3">
                  {[
                    { step: '1', label: '현지 직원 응대', color: 'blue' },
                    { step: '2', label: 'PM 검수 & 수정', color: 'orange' },
                    { step: '3', label: '병원에 최종 전달', color: 'green' },
                  ].map((s, i) => (
                    <div key={i}>
                      {i > 0 && <div className="flex items-center justify-center"><div className="w-px h-6 bg-gray-300"></div></div>}
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 bg-${s.color}-100 rounded-full flex items-center justify-center flex-shrink-0`}>
                          <span className={`text-sm font-bold text-${s.color}-600`}>{s.step}</span>
                        </div>
                        <div className="flex-1"><p className="text-sm font-semibold text-gray-900">{s.label}</p></div>
                        {i === 2 && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 space-y-2">
                {['의학 용어 팩트 체크', '친절도 품질 관리'].map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-green-600" /><span>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
