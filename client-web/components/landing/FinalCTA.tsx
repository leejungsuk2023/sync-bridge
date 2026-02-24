'use client';

import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, Mail, Phone } from 'lucide-react';
import { useState } from 'react';

export function FinalCTA() {
  const [formData, setFormData] = useState({ name: '', hospital: '', phone: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert('문의가 접수되었습니다. 24시간 내에 연락드리겠습니다.');
    setFormData({ name: '', hospital: '', phone: '', message: '' });
  };

  return (
    <>
      {/* CTA Banner */}
      <section className="py-24 bg-gradient-to-br from-[#004EE6] to-[#0033AA] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-96 h-96 bg-white rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-white rounded-full blur-3xl"></div>
        </div>
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-center">
            <h2 className="text-4xl lg:text-6xl font-bold text-white mb-6 leading-tight">
              마케터 1명 인건비로,<br />&lsquo;전문 팀&rsquo;을 통째로 이식하세요.
            </h2>
            <p className="text-xl lg:text-2xl text-blue-100 mb-8 max-w-3xl mx-auto">채용, 관리, 교육 걱정 없이 즉시 가동되는 의료관광 마케팅 전문 팀</p>

            <div className="bg-white/10 backdrop-blur-sm rounded-3xl p-8 max-w-2xl mx-auto mb-12 border-2 border-white/30">
              <div className="text-blue-100 text-lg mb-2">All-Inclusive 구독료</div>
              <div className="text-6xl lg:text-7xl font-bold text-white mb-4">월 170만 원</div>
              <div className="inline-block bg-gradient-to-r from-orange-500 to-red-500 text-white px-6 py-2 rounded-full font-bold mb-4">직접 고용 대비 연간 2,160만 원 절감</div>
              <p className="text-blue-100 text-sm">전담 마케터 + 업무 관제 시스템 + 한국인 PM 관리 + 지식 DB 전부 포함</p>
            </div>

            <button
              className="bg-white text-[#004EE6] hover:bg-gray-100 px-10 py-5 text-xl font-bold rounded-2xl shadow-2xl transition-all inline-flex items-center group"
              onClick={() => document.getElementById('contact-form')?.scrollIntoView({ behavior: 'smooth' })}
            >
              1분 만에 상담 신청하기
              <ArrowRight className="ml-3 w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </button>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-blue-100">
              {['24시간 내 답변', '무료 컨설팅', '부담 없는 견적'].map((t, i) => (
                <div key={i} className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-green-300" /><span>{t}</span></div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Contact Form */}
      <section id="contact-form" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div id="contact" className="grid lg:grid-cols-2 gap-16 max-w-6xl mx-auto">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}>
              <h3 className="text-3xl font-bold mb-4">무료 상담 신청</h3>
              <p className="text-gray-600 mb-8">귀원에 맞는 최적의 솔루션을 제안해 드립니다</p>
              <form onSubmit={handleSubmit} className="space-y-5">
                {[
                  { label: '담당자 성함 *', placeholder: '홍길동', field: 'name' as const },
                  { label: '병원명 *', placeholder: '○○성형외과', field: 'hospital' as const },
                  { label: '연락처 *', placeholder: '010-0000-0000', field: 'phone' as const, type: 'tel' },
                ].map((item) => (
                  <div key={item.field}>
                    <label className="block text-sm font-semibold mb-2 text-gray-900">{item.label}</label>
                    <input
                      required
                      type={item.type || 'text'}
                      placeholder={item.placeholder}
                      value={formData[item.field]}
                      onChange={(e) => setFormData({ ...formData, [item.field]: e.target.value })}
                      className="w-full h-12 px-4 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004EE6] focus:border-[#004EE6] outline-none transition-all"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-900">문의 내용</label>
                  <textarea
                    placeholder="궁금하신 내용을 자유롭게 작성해 주세요"
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full min-h-[120px] px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#004EE6] focus:border-[#004EE6] outline-none transition-all resize-y"
                  />
                </div>
                <button type="submit" className="w-full bg-[#004EE6] hover:bg-[#0043CC] text-white py-4 text-lg font-semibold rounded-xl inline-flex items-center justify-center gap-2 transition-colors">
                  <Mail className="w-5 h-5" /> 무료 상담 신청하기
                </button>
                <p className="text-xs text-gray-500 text-center">접수하신 정보는 상담 목적으로만 사용되며 안전하게 관리됩니다.</p>
              </form>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} className="space-y-8">
              <div>
                <h3 className="text-3xl font-bold mb-6">직접 문의</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                    <div className="w-12 h-12 bg-[#004EE6] rounded-xl flex items-center justify-center"><Phone className="w-6 h-6 text-white" /></div>
                    <div><div className="text-sm text-gray-600">대표 전화</div><div className="text-lg font-bold text-gray-900">02-1234-5678</div></div>
                  </div>
                  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-xl">
                    <div className="w-12 h-12 bg-[#004EE6] rounded-xl flex items-center justify-center"><Mail className="w-6 h-6 text-white" /></div>
                    <div><div className="text-sm text-gray-600">이메일</div><div className="text-lg font-bold text-gray-900">contact@syncbridge.co.kr</div></div>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <p className="text-sm text-gray-700"><strong className="text-gray-900">운영 시간:</strong> 평일 09:00 - 18:00</p>
                  <p className="text-xs text-gray-600 mt-1">주말/공휴일 문의는 익일 순차 응대됩니다</p>
                </div>
              </div>
              <div className="bg-gradient-to-br from-blue-50 to-white rounded-2xl p-8 border-2 border-blue-200">
                <h4 className="text-xl font-bold mb-4">상담 신청 시 제공</h4>
                <ul className="space-y-3">
                  {['귀원 맞춤형 솔루션 제안서', 'ROI 시뮬레이션 (비용 절감 분석)', '타 병원 성공 사례 공유', '1개월 무료 체험 기회 (조건부)'].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-[#004EE6] flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-[#004EE6] to-[#0066FF] rounded-lg flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path d="M4 10L8 14L16 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="text-xl font-bold text-white">SyncBridge</span>
            </div>
            <div className="text-sm text-center md:text-right">
              <p>&copy; 2026 Bluebridge Global. All rights reserved.</p>
              <p className="mt-1">㈜블루브릿지글로벌 | 의료관광 BPO 솔루션</p>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
