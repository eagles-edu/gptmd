<script setup lang="ts">
import type { PolicySection } from '~/components/PolicyDocument.vue'

useHead({ title: 'Refunds and cancellation | GPTpatient' })

const vietnamese: PolicySection[] = [
  {
    heading: 'Tình trạng thanh toán hiện tại',
    paragraphs: ['GPTpatient hiện chưa cung cấp thanh toán hoặc thu phí trực tiếp trên ứng dụng. Trang checkout hiện có chỉ là bản minh họa và không xử lý giao dịch. Vì vậy, hiện chưa có khoản thanh toán GPTpatient nào để yêu cầu hoàn tiền hoặc hủy gia hạn.']
  },
  {
    heading: 'Hủy quyền truy cập',
    paragraphs: ['Quyền truy cập hiện dựa trên tư cách thành viên của workspace GPTpatient. Nếu bạn cần chấm dứt quyền truy cập hoặc cho rằng thành viên bị cấu hình sai, hãy liên hệ hỗ trợ qua trang Contact. Không có gia hạn tự động được thiết lập bởi ứng dụng hiện tại.']
  },
  {
    heading: 'Khi thanh toán được mở trong tương lai',
    paragraphs: ['Trước khi nhận thanh toán, GPTpatient sẽ công bố điều kiện hủy, hoàn tiền, thời điểm cung cấp dịch vụ, thông tin đơn vị cung cấp và quy trình khiếu nại áp dụng cho giao dịch thực tế. Điều kiện của nhà cung cấp thanh toán sẽ được nêu rõ tại bước thanh toán; không áp dụng thời hạn hoàn tiền hoặc phương thức hoàn tiền chưa được xác nhận.']
  }
]

const english: PolicySection[] = [
  {
    heading: 'Current payment status',
    paragraphs: ['GPTpatient does not currently take payment or charge users in the application. The checkout page is a visual demonstration only and does not process transactions. There are therefore no GPTpatient payments currently eligible for a refund or recurring renewal cancellation.']
  },
  {
    heading: 'Ending access',
    paragraphs: ['Access currently depends on membership in a GPTpatient workspace. Contact support through the Contact page to request access removal or correction of a membership error. The current application does not set up automatic renewals.']
  },
  {
    heading: 'Before payments become available',
    paragraphs: ['Before accepting payment, GPTpatient will publish the cancellation and refund terms, service-provision timing, provider identity, and complaint process that apply to the actual transaction. Payment-provider terms will be disclosed at checkout. No unverified refund period or refund method is promised here.']
  }
]
</script>

<template>
  <PolicyDocument
    title="Refunds and cancellation"
    subtitle="Chính sách hoàn tiền và hủy dịch vụ"
    :vietnamese="vietnamese"
    :english="english"
  />
</template>
