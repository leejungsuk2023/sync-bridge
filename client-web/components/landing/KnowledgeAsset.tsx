'use client';

import { motion } from 'framer-motion';
import { Database, Folder, FileText, Zap, CheckCircle2 } from 'lucide-react';

export function KnowledgeAsset() {
  return (
    <section className="py-24 bg-[#F8F9FA]">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center max-w-6xl mx-auto">
          <motion.div initial={{ opacity: 0, x: -50 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="relative">
            <div className="bg-white rounded-2xl shadow-2xl border-2 border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-6 py-4">
                <div className="flex items-center gap-3">
                  <Database className="w-6 h-6 text-white" />
                  <span className="text-white font-bold text-lg">Hospital Knowledge DB</span>
                </div>
              </div>
              <div className="p-6 space-y-4">
                {[
                  { icon: Folder, color: 'blue', title: '시술 안내 템플릿', desc: '보톡스, 필러, 리프팅 등 48건' },
                  { icon: Folder, color: 'green', title: '상담 응대 스크립트', desc: '가격 문의, 예약 확정 등 32건' },
                  { icon: FileText, color: 'purple', title: '이벤트 프로모션', desc: '월별 프로모션 내역 12건' },
                ].map((item, i) => (
                  <div key={i} className={`flex items-center gap-4 p-4 bg-${item.color}-50 rounded-xl border border-${item.color}-200 hover:shadow-md transition-shadow`}>
                    <div className={`w-12 h-12 bg-${item.color}-600 rounded-lg flex items-center justify-center flex-shrink-0`}>
                      <item.icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{item.title}</p>
                      <p className="text-sm text-gray-600">{item.desc}</p>
                    </div>
                    <div className={`text-xs bg-${item.color}-600 text-white px-3 py-1 rounded-full font-semibold`}>저장됨</div>
                  </div>
                ))}
              </div>
              <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">총 저장된 노하우</span>
                  <span className="font-bold text-purple-600">92개 항목</span>
                </div>
              </div>
            </div>
            <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
              className="absolute -bottom-6 -right-6 bg-white rounded-xl shadow-xl border-2 border-purple-200 p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-600 rounded-full flex items-center justify-center"><Zap className="w-5 h-5 text-white" /></div>
                <div><p className="text-sm font-bold text-gray-900">자동 저장</p><p className="text-xs text-gray-600">실시간 업데이트</p></div>
              </div>
            </motion.div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 50 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }}>
            <div className="inline-block mb-6">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-100 rounded-full">
                <Database className="w-4 h-4 text-purple-600" />
                <span className="text-sm font-semibold text-purple-600">Knowledge Asset</span>
              </div>
            </div>
            <h2 className="text-4xl lg:text-5xl font-bold mb-6 leading-tight">
              직원이 퇴사해도,<br />병원의 노하우는<br /><span className="text-purple-600">영원히 남습니다.</span>
            </h2>
            <p className="text-xl text-gray-700 mb-8 leading-relaxed">
              모든 상담 내역과 템플릿은 귀원 전용 DB에 영구 저장됩니다. 인력이 교체되어도 인수인계 시간은 <strong className="text-purple-600">0초</strong>입니다.
            </p>
            <div className="space-y-4 mb-8">
              {[
                { title: '반복 응대 자동화', desc: '이벤트 안내, 시술 후 주의사항 등 자주 쓰는 응대는 클릭 한 번으로 전송' },
                { title: '누적된 병원 노하우', desc: '시간이 지날수록 귀원만의 상담 지식이 시스템에 계속 쌓입니다' },
                { title: '일관된 상담 품질', desc: '누가 응대하든 동일한 퀄리티의 상담이 이루어집니다' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-1">
                    <CheckCircle2 className="w-4 h-4 text-purple-600" />
                  </div>
                  <div><p className="font-semibold text-gray-900 mb-1">{item.title}</p><p className="text-gray-600">{item.desc}</p></div>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 rounded-2xl p-6 text-white">
              <p className="text-lg font-bold mb-2">병원의 지식 자산이 시스템에 영구 보존됩니다</p>
              <p className="text-purple-100">담당자가 바뀌어도 처음부터 다시 가르칠 필요 없이, 축적된 노하우를 즉시 활용할 수 있습니다.</p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
