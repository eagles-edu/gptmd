<script setup lang="ts">
import type { PolicySection } from '~/components/PolicyDocument.vue'

useHead({ title: 'Service provision and activation | GPTpatient' })

const vietnamese: PolicySection[] = [
  {
    heading: 'Cách cung cấp dịch vụ hiện tại',
    paragraphs: ['GPTpatient là ứng dụng luyện tập giao tiếp lâm sàng bằng tình huống giả lập. Quyền sử dụng phần cần đăng nhập phụ thuộc vào tài khoản đã xác thực và thành viên workspace GPTpatient đang hoạt động. Dịch vụ được cung cấp trực tuyến; không có hàng hóa vật lý được giao.']
  },
  {
    heading: 'Kích hoạt và sự cố truy cập',
    paragraphs: ['Ứng dụng hiện không bán quyền truy cập qua checkout và không phát hành mã bản quyền hoặc email kích hoạt tự động. Nếu bạn đã được cấp workspace nhưng không truy cập được, hãy liên hệ qua trang Contact và nêu email đăng nhập cùng mô tả lỗi; không gửi mật khẩu, mã xác thực hoặc dữ liệu bệnh nhân thật.']
  },
  {
    heading: 'Thông tin trước giao dịch',
    paragraphs: ['Nếu gói trả phí được triển khai, trang này sẽ được cập nhật trước khi giao dịch mở để nêu rõ thời điểm bắt đầu, thời hạn truy cập, cách xác nhận thanh toán, quy trình xử lý thanh toán bị treo và kênh hỗ trợ. Hiện chưa có cổng ACB, Google Pay hay quy trình thanh toán nào được xác nhận là đang hoạt động.']
  }
]

const english: PolicySection[] = [
  {
    heading: 'How the current service is provided',
    paragraphs: ['GPTpatient is an online clinical-communication practice application using fictional scenarios. Access to sign-in features depends on an authenticated account and active GPTpatient workspace membership. The service is delivered online; no physical goods are shipped.']
  },
  {
    heading: 'Access and service problems',
    paragraphs: ['The application does not currently sell access through checkout or automatically issue license keys or activation emails. If you have been assigned a workspace but cannot access it, use the Contact page and describe the sign-in email and issue. Do not send passwords, verification codes, or real patient data.']
  },
  {
    heading: 'Information before a paid transaction',
    paragraphs: ['If paid plans are introduced, this page will be updated before checkout opens with the start date, access period, payment confirmation method, stalled-payment process, and support channel. No ACB, Google Pay, or other payment flow is currently confirmed as active.']
  }
]
</script>

<template>
  <PolicyDocument
    title="Service provision and activation"
    subtitle="Chính sách cung cấp và kích hoạt dịch vụ"
    :vietnamese="vietnamese"
    :english="english"
  />
</template>
