'use client';

import { motion } from 'framer-motion';
import { Users, ArrowRight, CheckCircle2 } from 'lucide-react';

export function OneToOneMatching() {
  const countries = [
    { flag: '🇹🇭', name: '태국', color: 'from-blue-500 to-blue-600' },
    { flag: '🇻🇳', name: '베트남', color: 'from-red-500 to-red-600' },
    { flag: '🇮🇩', name: '인도네시아', color: 'from-green-500 to-green-600' },
  ];

  return (
    <section className="py-24 bg-white relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-blue-50/50 to-transparent pointer-events-none"></div>
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 rounded-full mb-6">
            <Users className="w-5 h-5 text-[#004EE6]" />
            <span className="text-sm font-semibold text-[#004EE6]">1:1 전담 매칭 시스템</span>
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold mb-6">
            귀원만을 위한<br /><span className="text-[#004EE6]">전용 전담 마케터</span>가 배정됩니다
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            여러 병원을 동시에 관리하는 프리랜서가 아닙니다. 오직 귀원만을 위해 일하는 1:1 전담 인력을 배정합니다.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto mb-16">
          <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="relative">
            <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 relative z-10">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-[#004EE6] to-[#0066FF] rounded-xl flex items-center justify-center">
                  <span className="text-3xl">🏥</span>
                </div>
                <div>
                  <div className="text-sm text-gray-600">귀원</div>
                  <div className="text-xl font-bold text-gray-900">○○성형외과</div>
                </div>
              </div>
              <div className="flex items-center justify-center my-8">
                <div className="flex items-center gap-3">
                  <div className="h-px w-20 bg-gradient-to-r from-[#004EE6] to-transparent"></div>
                  <div className="relative">
                    <div className="w-12 h-12 bg-gradient-to-br from-[#004EE6] to-[#0066FF] rounded-full flex items-center justify-center animate-pulse">
                      <ArrowRight className="w-6 h-6 text-white" />
                    </div>
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
                      <span className="text-xs font-bold text-[#004EE6] bg-blue-50 px-3 py-1 rounded-full">1:1 매칭</span>
                    </div>
                  </div>
                  <div className="h-px w-20 bg-gradient-to-l from-[#004EE6] to-transparent"></div>
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-white rounded-xl border-2 border-blue-200 p-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full flex items-center justify-center text-2xl">👩‍💼</div>
                  <div className="flex-1">
                    <div className="text-sm text-gray-600">전담 마케터</div>
                    <div className="font-bold text-gray-900">Somchai (태국)</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                    <span className="text-xs text-gray-600">전담 근무중</span>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-blue-200">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-white rounded-lg p-2 text-center">
                      <div className="text-xs text-gray-600">월 근무시간</div>
                      <div className="font-bold text-[#004EE6]">160h</div>
                    </div>
                    <div className="bg-white rounded-lg p-2 text-center">
                      <div className="text-xs text-gray-600">전담도</div>
                      <div className="font-bold text-[#004EE6]">100%</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.5 }}
              className="absolute -bottom-6 -right-6 bg-white rounded-xl shadow-xl border-2 border-green-200 px-6 py-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <div><div className="text-xs text-gray-600">귀원 전용</div><div className="font-bold text-gray-900">전담 보장</div></div>
              </div>
            </motion.div>
          </motion.div>

          <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="space-y-6">
            {[
              { color: 'blue', title: '오직 귀원만을 위해 근무', desc: '다른 병원과 시간을 쪼개어 쓰지 않습니다. 월 160시간을 귀원 업무에만 집중합니다.' },
              { color: 'purple', title: '병원 맞춤형 업무 숙지', desc: '귀원의 시술 메뉴, 가격, 프로모션을 완벽하게 숙지한 전담 인력이 응대합니다.' },
              { color: 'green', title: '빠른 소통 & 즉시 대응', desc: '지시사항 전달 시 바로 확인하고 실행합니다. 여러 클라이언트 사이에서 우선순위 밀림 없음.' },
              { color: 'orange', title: '지속적인 업무 노하우 축적', desc: '같은 인력이 장기간 전담하므로 병원 특성과 노하우가 계속 쌓입니다.' },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-4">
                <div className={`w-12 h-12 bg-${item.color}-100 rounded-xl flex items-center justify-center flex-shrink-0`}>
                  <CheckCircle2 className={`w-6 h-6 text-${item.color}-600`} />
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2 text-gray-900">{item.title}</h3>
                  <p className="text-gray-600">{item.desc}</p>
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
          className="bg-gradient-to-br from-gray-50 to-white rounded-3xl border-2 border-gray-200 p-8 lg:p-12 max-w-5xl mx-auto">
          <div className="text-center mb-8">
            <h3 className="text-2xl font-bold mb-3">지원 가능 국가</h3>
            <p className="text-gray-600">각 국가별 전문 마케터 Pool 보유. 귀원의 타겟 국가에 맞는 인력을 배정합니다.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-lg mx-auto">
            {countries.map((country, index) => (
              <motion.div key={index} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: index * 0.1 }}
                className="bg-white rounded-xl border-2 border-gray-200 p-4 hover:border-[#004EE6] hover:shadow-lg transition-all group cursor-pointer">
                <div className={`w-12 h-12 bg-gradient-to-br ${country.color} rounded-xl flex items-center justify-center text-2xl mb-3 mx-auto group-hover:scale-110 transition-transform`}>
                  {country.flag}
                </div>
                <div className="text-center font-semibold text-gray-900">{country.name}</div>
                <div className="text-xs text-center text-gray-500 mt-1">전문 인력 보유</div>
              </motion.div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-600"><strong className="text-gray-900">+ 기타 국가</strong> 문의 시 맞춤 인력 매칭 가능</p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
