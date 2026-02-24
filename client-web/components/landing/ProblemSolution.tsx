'use client';

import { motion } from 'framer-motion';
import { X, CheckCircle2, AlertTriangle, Sparkles } from 'lucide-react';

export function ProblemSolution() {
  return (
    <section className="py-24 bg-[#F8F9FA]">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">직접 채용 vs SyncBridge 구독</h2>
          <p className="text-xl text-gray-600">복잡하고 비싼 직접 고용, 이제 그만하세요</p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {/* Direct Hire */}
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="relative">
            <div className="absolute -top-3 left-6 z-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-full shadow-lg">
                <AlertTriangle className="w-4 h-4" /><span className="text-sm font-bold">기존 방식</span>
              </div>
            </div>
            <div className="bg-white rounded-2xl border-2 border-gray-300 p-8 pt-12 h-full">
              <h3 className="text-2xl font-bold mb-6 text-gray-900">외국인 직접 채용</h3>
              <div className="mb-8 pb-8 border-b border-gray-200">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-4xl font-bold text-gray-400">월 350만 원</span>
                  <span className="text-lg text-gray-500">이상</span>
                </div>
                <p className="text-sm text-gray-600">4대 보험 + 퇴직금 + 비자 발급 포함</p>
              </div>
              <div className="space-y-4">
                {[
                  { title: '복잡한 E-7 비자 절차', desc: '서류 준비, 출입국 관리, 법무사 비용 별도' },
                  { title: '업무 통제 불가', desc: '재택 시 업무 현황 파악 어려움, 생산성 저하' },
                  { title: '교육 부담 + 기회비용', desc: '의료 용어, 병원 시스템 교육에 수개월 소요' },
                  { title: '퇴사 시 공백 발생', desc: '재채용, 재교육으로 업무 중단 최소 1~2개월' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <X className="w-4 h-4 text-red-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{item.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* SyncBridge */}
          <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="relative">
            <div className="absolute -top-3 left-6 z-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#004EE6] to-[#0066FF] text-white rounded-full shadow-lg">
                <Sparkles className="w-4 h-4" /><span className="text-sm font-bold">SyncBridge</span>
              </div>
            </div>
            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-2xl blur-xl"></div>
            <div className="relative bg-gradient-to-br from-blue-50 to-white rounded-2xl border-2 border-[#004EE6] p-8 pt-12 h-full shadow-xl">
              <h3 className="text-2xl font-bold mb-6 text-gray-900">SyncBridge 구독</h3>
              <div className="mb-8 pb-8 border-b border-blue-200">
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-5xl font-bold text-[#004EE6]">월 170만 원</span>
                </div>
                <div className="inline-block bg-[#004EE6] text-white px-3 py-1 rounded-full text-sm font-bold">All-inclusive</div>
                <p className="text-sm text-gray-600 mt-2">인력 + 시스템 + PM 관리 전부 포함</p>
              </div>
              <div className="space-y-4">
                {[
                  { title: '즉시 투입', desc: '비자, 채용 걱정 없이 2주 내 전담 마케터 배정' },
                  { title: '100% 투명한 업무 관제', desc: '실시간 대시보드로 업무 현황, 출퇴근 완벽 모니터링' },
                  { title: '의료 특화 교육 완료', desc: '시술 용어, CS 매뉴얼 숙지된 인력만 투입' },
                  { title: '업무 공백 Zero', desc: '인력 교체 시 대기 인력 즉시 투입, 중단 없음' },
                ].map((item, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900">{item.title}</p>
                      <p className="text-sm text-gray-600 mt-1">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-8 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-4 text-center">
                <p className="text-white font-bold text-lg">연간 2,160만 원 절감</p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
