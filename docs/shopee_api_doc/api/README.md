# Shopee Open Platform API 参考目录（v2，中文版）

> 数据来源：`/doc/module?version=2`，抓取于 2026-08-15，共 30 个模块、454 个条目。
> 官方页面：<https://open.shopee.cn/documents>

说明：

- 接口名保持官方标识符（如 `v2.ams.get_open_campaign_added_product`）不变，仅模块名给出中文译名。
- 接口官方页面按规律拼接（中国站）：`https://open.shopee.cn/documents/v2/{api_name}?module={模块ID}&type=1`，模块 ID 见「模块总览」。
- 「指南总览」模块下为文档指南页（非 API），官方跳转按规律拼接：`https://open.shopee.com/developer-guide?from=doc&id={条目编号}`。

## 模块总览

| 模块 | 中文名称 | 模块 ID | 条目数 |
|---|---|---|---|
| [`Overview`](#指南总览overview) | 指南总览 | 87 | 10 |
| [`AMS`](#联盟营销ams) | 联盟营销 | 127 | 36 |
| [`Video`](#视频video) | 视频 | 129 | 15 |
| [`Product`](#商品product) | 商品 | 89 | 58 |
| [`GlobalProduct`](#全球商品globalproduct) | 全球商品 | 90 | 34 |
| [`MediaSpace`](#媒体空间mediaspace) | 媒体空间 | 91 | 6 |
| [`Media`](#媒体media) | 媒体 | 130 | 6 |
| [`Shop`](#店铺shop) | 店铺 | 92 | 9 |
| [`Merchant`](#商家merchant) | 商家 | 93 | 6 |
| [`Order`](#订单order) | 订单 | 94 | 22 |
| [`Logistics`](#物流logistics) | 物流 | 95 | 46 |
| [`FirstMile`](#首公里firstmile) | 首公里 | 96 | 16 |
| [`Payment`](#支付payment) | 支付 | 97 | 18 |
| [`Discount`](#折扣活动discount) | 折扣活动 | 99 | 12 |
| [`Bundle Deal`](#捆绑销售bundle-deal) | 捆绑销售 | 110 | 10 |
| [`Add-On Deal`](#加购优惠add-on-deal) | 加购优惠 | 111 | 14 |
| [`Voucher`](#优惠券voucher) | 优惠券 | 112 | 6 |
| [`ShopFlashSale`](#店铺闪购shopflashsale) | 店铺闪购 | 123 | 11 |
| [`Follow Prize`](#关注有礼follow-prize) | 关注有礼 | 113 | 6 |
| [`TopPicks`](#热门精选toppicks) | 热门精选 | 100 | 4 |
| [`ShopCategory`](#店铺分类shopcategory) | 店铺分类 | 101 | 7 |
| [`Returns`](#退货退款returns) | 退货退款 | 102 | 15 |
| [`AccountHealth`](#账户健康accounthealth) | 账户健康 | 103 | 6 |
| [`Ads`](#广告ads) | 广告 | 117 | 25 |
| [`Public`](#公共public) | 公共 | 104 | 6 |
| [`Push`](#消息推送push) | 消息推送 | 105 | 4 |
| [`SBS`](#官方仓与库存sbs) | 官方仓与库存 | 124 | 6 |
| [`FBS`](#官方履约巴西fbs) | 官方履约（巴西） | 126 | 4 |
| [`Livestream`](#直播livestream) | 直播 | 125 | 25 |
| [`BrandPortal`](#品牌门户brandportal) | 品牌门户 | 139 | 11 |

## 指南总览（Overview）

- 介绍（Introduction，编号 64）
- OpenAPI 2.0 概览（OpenAPI 2.0 Overview，编号 58）
- OpenAPI 2.0 概览（中文版）（[中文版] OpenAPI 2.0 Overview，编号 65）
- CNSC API 对接用户手册（[中文版]CNSC API对接用户手册，编号 69）
- KRSC API 集成指南（KRSC API Integration Guide，编号 74）
- 开发者指南（Developer Guide，编号 59）
- API 调用流程（API Call Flows，编号 60）
- 开发者类型与应用类型（Developer Types and APP Types，编号 61）
- 数据定义（Data Definition，编号 62）
- 消息推送机制（WebHook）（Push Mechanism(WebHook)，编号 63）

## 联盟营销（AMS）

- `v2.ams.get_open_campaign_added_product`
- `v2.ams.get_open_campaign_not_added_product`
- `v2.ams.batch_add_products_to_open_campaign`
- `v2.ams.add_all_products_to_open_campaign`
- `v2.ams.get_auto_add_new_product_toggle_status`
- `v2.ams.update_auto_add_new_product_setting`
- `v2.ams.batch_edit_products_open_campaign_setting`
- `v2.ams.edit_all_products_open_campaign_setting`
- `v2.ams.batch_remove_products_open_campaign_setting`
- `v2.ams.remove_all_products_open_campaign_setting`
- `v2.ams.get_open_campaign_batch_task_result`
- `v2.ams.get_optimization_suggestion_product`
- `v2.ams.batch_get_products_suggested_rate`
- `v2.ams.get_shop_suggested_rate`
- `v2.ams.get_targeted_campaign_addable_product_list`
- `v2.ams.get_recommended_affiliate_list`
- `v2.ams.get_managed_affiliate_list`
- `v2.ams.query_affiliate_list`
- `v2.ams.create_new_targeted_campaign`
- `v2.ams.get_targeted_campaign_list`
- `v2.ams.get_targeted_campaign_settings`
- `v2.ams.update_basic_info_of_targeted_campaign`
- `v2.ams.edit_product_list_of_targeted_campaign`
- `v2.ams.edit_affiliate_list_of_targeted_campaign`
- `v2.ams.terminate_targeted_campaign`
- `v2.ams.get_performance_data_update_time`
- `v2.ams.get_shop_performance`
- `v2.ams.get_product_performance`
- `v2.ams.get_affiliate_performance`
- `v2.ams.get_content_performance`
- `v2.ams.get_campaign_key_metrics_performance`
- `v2.ams.get_open_campaign_performance`
- `v2.ams.get_targeted_campaign_performance`
- `v2.ams.get_conversion_report`
- `v2.ams.get_validation_list`
- `v2.ams.get_validation_report`

## 视频（Video）

- `v2.video.get_cover_list`
- `v2.video.edit_video_info`
- `v2.video.post_video`
- `v2.video.get_video_list`
- `v2.video.get_video_detail`
- `v2.video.delete_video`
- `v2.video.get_overview_performance`
- `v2.video.get_metric_trend`
- `v2.video.get_user_demographics`
- `v2.video.get_video_performance_list`
- `v2.video.get_prodcut_performance_list`
- `v2.video.get_video_detail_performance`
- `v2.video.get_video_detail_metric_trend`
- `v2.video.get_video_detail_audience_distribution`
- `v2.video.get_video_detail_product_performance`

## 商品（Product）

- `v2.product.get_category`
- `v2.product.get_attribute_tree`
- `v2.product.get_brand_list`
- `v2.product.get_item_limit`
- `v2.product.get_item_list`
- `v2.product.get_item_base_info`
- `v2.product.get_item_extra_info`
- `v2.product.add_item`
- `v2.product.update_item`
- `v2.product.delete_item`
- `v2.product.init_tier_variation`
- `v2.product.update_tier_variation`
- `v2.product.get_model_list`
- `v2.product.add_model`
- `v2.product.update_model`
- `v2.product.delete_model`
- `v2.product.unlist_item`
- `v2.product.update_price`
- `v2.product.update_stock`
- `v2.product.boost_item`
- `v2.product.get_boosted_list`
- `v2.product.get_item_promotion`
- `v2.product.update_sip_item_price`
- `v2.product.search_item`
- `v2.product.get_comment`
- `v2.product.reply_comment`
- `v2.product.category_recommend`
- `v2.product.register_brand`
- `v2.product.get_recommend_attribute`
- `v2.product.get_weight_recommendation`
- `v2.product.get_size_chart_list `
- `v2.product.get_size_chart_detail`
- `v2.product.get_item_violation_info`
- `v2.product.get_variations`
- `v2.product.get_all_vehicle_list`
- `v2.product.get_vehicle_list_by_compatibility_detail`
- `v2.product.get_item_content_diagnosis_result`
- `v2.product.get_item_list_by_content_diagnosis`
- `v2.product.get_kit_item_limit`
- `v2.product.add_kit_item`
- `v2.product.update_kit_item`
- `v2.product.get_kit_item_info`
- `v2.product.get_aitem_by_pitem_id`
- `v2.product.search_attribute_value_list`
- `v2.product.get_main_item_list`
- `v2.product.get_direct_item_list`
- `v2.product.get_direct_shop_recommended_price`
- `v2.product.get_product_certification_rule`
- ` v2.product.publish_item_to_outlet_shop`
- `v2.product.get_mart_item_mapping_by_id`
- `v2.product.search_unpackaged_model_list`
- `v2.product.generate_kit_image`
- `v2.product.get_mart_item_by_outlet_item_id`
- `v2.product.batch_update_outlet_price`
- `v2.product.batch_update_outlet_stock`
- `v2.product.get_batch_task_result`
- `v2.product.batch_add_item`
- `v2.product.batch_publish_item_to_outlet_shop`

## 全球商品（GlobalProduct）

- `v2.global_product.get_category`
- `v2.global_product.get_attribute_tree`
- `v2.global_product.get_brand_list`
- `v2.global_product.get_global_item_limit`
- `v2.global_product.get_global_item_list`
- `v2.global_product.get_global_item_info`
- `v2.global_product.add_global_item`
- `v2.global_product.update_global_item`
- `v2.global_product.delete_global_item`
- `v2.global_product.init_tier_variation`
- `v2.global_product.update_tier_variation`
- `v2.global_product.add_global_model`
- `v2.global_product.update_global_model`
- `v2.global_product.delete_global_model`
- `v2.global_product.get_global_model_list`
- `v2.global_product.support_size_chart`
- `v2.global_product.update_size_chart`
- `v2.global_product.create_publish_task`
- `v2.global_product.get_publishable_shop`
- `v2.global_product.get_publish_task_result`
- `v2.global_product.get_published_list`
- `v2.global_product.update_price`
- `v2.global_product.update_stock`
- `v2.global_product.set_sync_field`
- `v2.global_product.get_global_item_id`
- `v2.global_product.category_recommend`
- `v2.global_product.get_recommend_attribute`
- `v2.global_product.get_shop_publishable_status`
- `v2.global_product.get_variations`
- `v2.global_product.get_size_chart_detail`
- `v2.global_product.get_size_chart_list `
- `v2.global_product.search_global_attribute_value_list`
- `v2.global_product.get_local_adjustment_rate`
- `v2.global_product.update_local_adjustment_rate`

## 媒体空间（MediaSpace）

- `v2.media_space.init_video_upload`
- `v2.media_space.upload_video_part`
- `v2.media_space.complete_video_upload`
- `v2.media_space.get_video_upload_result`
- `v2.media_space.cancel_video_upload`
- `v2.media_space.upload_image`

## 媒体（Media）

- `v2.media.upload_image`
- `v2.media.init_video_upload`
- `v2.media.upload_video_part`
- `v2.media.complete_video_upload`
- `v2.media.get_video_upload_result`
- `v2.media.cancel_video_upload`

## 店铺（Shop）

- `v2.shop.get_shop_info`
- `v2.shop.get_profile`
- `v2.shop.update_profile`
- `v2.shop.get_warehouse_detail`
- `v2.shop.get_shop_notification`
- `v2.shop.get_authorised_reseller_brand`
- `v2.shop.get_br_shop_onboarding_info`
- `v2.shop.get_shop_holiday_mode`
- `v2.shop.set_shop_holiday_mode`

## 商家（Merchant）

- `v2.merchant.get_merchant_info`
- `v2.merchant.get_shop_list_by_merchant`
- `v2.merchant.get_merchant_warehouse_location_list`
- `v2.merchant.get_merchant_warehouse_list`
- `v2.merchant.get_warehouse_eligible_shop_list`
- `v2.merchant.get_merchant_prepaid_account_list`

## 订单（Order）

- `v2.order.get_order_list`
- `v2.order.get_order_detail`
- `v2.order.get_shipment_list`
- `v2.order.search_package_list`
- `v2.order.get_package_detail`
- `v2.order.split_order`
- `v2.order.unsplit_order`
- `v2.order.cancel_order`
- `v2.order.handle_buyer_cancellation`
- `v2.order.set_note`
- `v2.order.get_pending_buyer_invoice_order_list`
- `v2.order.get_buyer_invoice_info`
- `v2.order.upload_invoice_doc`
- `v2.order.download_invoice_doc`
- `v2.order.handle_prescription_check`
- `v2.order.get_warehouse_filter_config`
- `v2.order.get_booking_list`
- `v2.order.get_booking_detail`
- `v2.order.generate_fbs_invoices`
- `v2.order.get_fbs_invoices_result`
- `v2.order.download_fbs_invoices`
- `v2.order.get_estimate_cancel_value`

## 物流（Logistics）

- `v2.logistics.get_shipping_parameter`
- `v2.logistics.get_mass_shipping_parameter`
- `v2.logistics.ship_order`
- `v2.logistics.mass_ship_order`
- `v2.logistics.update_shipping_order`
- `v2.logistics.get_tracking_number`
- `v2.logistics.get_mass_tracking_number`
- `v2.logistics.get_shipping_document_parameter`
- `v2.logistics.create_shipping_document`
- `v2.logistics.get_shipping_document_result`
- `v2.logistics.download_shipping_document`
- `v2.logistics.get_shipping_document_data_info`
- `v2.logistics.get_tracking_info`
- `v2.logistics.get_address_list`
- `v2.logistics.set_address_config`
- `v2.logistics.update_address`
- `v2.logistics.delete_address`
- `v2.logistics.get_channel_list`
- `v2.logistics.update_channel`
- `v2.logistics.get_operating_hours`
- `v2.logistics.get_operating_hour_restrictions`
- `v2.logistics.update_operating_hours`
- `v2.logistics.delete_special_operating_hour`
- `v2.logistics.batch_update_tpf_warehouse_tracking_status`
- `v2.logistics.batch_ship_order`
- `v2.logistics.update_tracking_status`
- `v2.logistics.get_booking_shipping_parameter`
- `v2.logistics.ship_booking`
- `v2.logistics.get_booking_tracking_number`
- `v2.logistics.get_booking_shipping_document_parameter`
- `v2.logistics.create_booking_shipping_document`
- `v2.logistics.get_booking_shipping_document_result`
- `v2.logistics.download_booking_shipping_document`
- `v2.logistics.get_booking_shipping_document_data_info`
- `v2.logistics.get_booking_tracking_info`
- `v2.logistics.download_to_label`
- `v2.logistics.create_shipping_document_job`
- `v2.logistics.get_shipping_document_job_status`
- `v2.logistics.download_shipping_document_job`
- `v2.logistics.update_self_collection_order_logistics`
- `v2.logistics.get_mart_packaging_info`
- `v2.logistics.set_mart_packaging_info`
- `v2.logistics.upload_serviceable_polygon`
- `v2.logistics.check_polygon_update_status`
- `v2.logistics.get_pause_status`
- `v2.logistics.set_pause_status`

## 首公里（FirstMile）

- `v2.first_mile.get_unbind_order_list`
- `v2.first_mile.get_detail`
- `v2.first_mile.generate_first_mile_tracking_number`
- `v2.first_mile.bind_first_mile_tracking_number`
- `v2.first_mile.unbind_first_mile_tracking_number`
- `v2.first_mile.get_tracking_number_list`
- `v2.first_mile.get_waybill`
- `v2.first_mile.get_channel_list`
- `v2.first_mile.get_courier_delivery_channel_list`
- `v2.first_mile.get_transit_warehouse_list`
- `v2.first_mile.generate_and_bind_first_mile_tracking_number`
- `v2.first_mile.bind_courier_delivery_first_mile_tracking_number`
- `v2.first_mile.unbind_first_mile_tracking_number_all`
- `v2.first_mile.get_courier_delivery_detail`
- `v2.first_mile.get_courier_delivery_waybill`
- `v2.first_mile.get_courier_delivery_tracking_number_list`

## 支付（Payment）

- `v2.payment.get_escrow_detail`
- `v2.payment.set_shop_installment_status`
- `v2.payment.get_shop_installment_status`
- `v2.payment.get_payout_detail`
- `v2.payment.set_item_installment_status`
- `v2.payment.get_item_installment_status`
- `v2.payment.get_payment_method_list`
- `v2.payment.get_wallet_transaction_list`
- `v2.payment.get_escrow_list`
- `v2.payment.get_payout_info`
- `v2.payment.get_billing_transaction_info`
- `v2.payment.get_escrow_detail_batch`
- `v2.payment.generate_income_statement`
- `v2.payment.get_income_statement`
- `v2.payment.generate_income_report`
- `v2.payment.get_income_report`
- `v2.payment.get_income_overview`
- `v2.payment.get_income_detail`

## 折扣活动（Discount）

- `v2.discount.add_discount`
- `v2.discount.add_discount_item`
- `v2.discount.delete_discount`
- `v2.discount.delete_discount_item`
- `v2.discount.get_discount`
- `v2.discount.get_discount_list`
- `v2.discount.update_discount`
- `v2.discount.update_discount_item`
- `v2.discount.end_discount`
- `v2.discount.get_sip_discounts`
- `v2.discount.set_sip_discount`
- `v2.discount.delete_sip_discount`

## 捆绑销售（Bundle Deal）

- `v2.bundle_deal.add_bundle_deal`
- `v2.bundle_deal.add_bundle_deal_item`
- `v2.bundle_deal.get_bundle_deal_list`
- `v2.bundle_deal.get_bundle_deal`
- `v2.bundle_deal.get_bundle_deal_item`
- `v2.bundle_deal.update_bundle_deal`
- `v2.bundle_deal.update_bundle_deal_item`
- `v2.bundle_deal.end_bundle_deal`
- `v2.bundle_deal.delete_bundle_deal`
- `v2.bundle_deal.delete_bundle_deal_item`

## 加购优惠（Add-On Deal）

- `v2.add_on_deal.add_add_on_deal`
- `v2.add_on_deal.add_add_on_deal_main_item`
- `v2.add_on_deal.add_add_on_deal_sub_item`
- `v2.add_on_deal.delete_add_on_deal`
- `v2.add_on_deal.delete_add_on_deal_main_item`
- `v2.add_on_deal.delete_add_on_deal_sub_item`
- `v2.add_on_deal.get_add_on_deal_list`
- `v2.add_on_deal.get_add_on_deal`
- `v2.add_on_deal.get_add_on_deal_main_item`
- `v2.add_on_deal.get_add_on_deal_sub_item`
- `v2.add_on_deal.update_add_on_deal`
- `v2.add_on_deal.update_add_on_deal_main_item`
- `v2.add_on_deal.update_add_on_deal_sub_item`
- `v2.add_on_deal.end_add_on_deal`

## 优惠券（Voucher）

- `v2.voucher.add_voucher`
- `v2.voucher.delete_voucher`
- `v2.voucher.end_voucher`
- `v2.voucher.update_voucher`
- `v2.voucher.get_voucher`
- `v2.voucher.get_voucher_list`

## 店铺闪购（ShopFlashSale）

- `v2.shop_flash_sale.get_time_slot_id`
- `v2.shop_flash_sale.create_shop_flash_sale`
- `v2.shop_flash_sale.get_item_criteria`
- `v2.shop_flash_sale.add_shop_flash_sale_items`
- `v2.shop_flash_sale.get_shop_flash_sale_list`
- `v2.shop_flash_sale.get_shop_flash_sale`
- `v2.shop_flash_sale.get_shop_flash_sale_items`
- `v2.shop_flash_sale.update_shop_flash_sale`
- `v2.shop_flash_sale.update_shop_flash_sale_items`
- `v2.shop_flash_sale.delete_shop_flash_sale`
- `v2.shop_flash_sale.delete_shop_flash_sale_items`

## 关注有礼（Follow Prize）

- `v2.follow_prize.add_follow_prize`
- `v2.follow_prize.delete_follow_prize`
- `v2.follow_prize.end_follow_prize`
- `v2.follow_prize.update_follow_prize`
- `v2.follow_prize.get_follow_prize_detail`
- `v2.follow_prize.get_follow_prize_list`

## 热门精选（TopPicks）

- `v2.top_picks.get_top_picks_list`
- `v2.top_picks.add_top_picks`
- `v2.top_picks.update_top_picks`
- `v2.top_picks.delete_top_picks`

## 店铺分类（ShopCategory）

- `v2.shop_category.add_shop_category`
- `v2.shop_category.get_shop_category_list`
- `v2.shop_category.delete_shop_category`
- `v2.shop_category.update_shop_category`
- `v2.shop_category.add_item_list`
- `v2.shop_category.get_item_list`
- `v2.shop_category.delete_item_list`

## 退货退款（Returns）

- `v2.returns.get_return_list`
- `v2.returns.get_return_detail`
- `v2.returns.confirm`
- `v2.returns.dispute`
- `v2.returns.get_available_solutions`
- `v2.returns.offer`
- `v2.returns.accept_offer`
- `v2.returns.convert_image`
- `v2.returns.upload_proof`
- `v2.returns.query_proof`
- `v2.returns.get_return_dispute_reason`
- `v2.returns.cancel_dispute`
- `v2.returns.get_shipping_carrier`
- `v2.returns.upload_shipping_proof`
- `v2.returns.get_reverse_tracking_info`

## 账户健康（AccountHealth）

- `v2.account_health.get_shop_performance`
- `v2.account_health.get_metric_source_detail`
- `v2.account_health.get_penalty_point_history`
- `v2.account_health.get_punishment_history`
- `v2.account_health.get_listings_with_issues`
- `v2.account_health.get_late_orders`

## 广告（Ads）

- `v2.ads.get_total_balance`
- `v2.ads.get_shop_toggle_info`
- `v2.ads.get_recommended_keyword_list`
- `v2.ads.get_recommended_item_list`
- `v2.ads.get_all_cpc_ads_hourly_performance`
- `v2.ads.get_all_cpc_ads_daily_performance`
- `(coming offline soon) v2.ads.create_auto_product_ads`
- `(coming offline soon) v2.ads.edit_auto_product_ads`
- `v2.ads.get_product_campaign_daily_performance`
- `v2.ads.get_product_campaign_hourly_performance`
- `v2.ads.get_product_level_campaign_id_list`
- `v2.ads.get_product_level_campaign_setting_info`
- `v2.ads.create_manual_product_ads`
- `v2.ads.edit_manual_product_ad_keywords`
- `v2.ads.edit_manual_product_ads`
- `v2.ads.get_create_product_ad_budget_suggestion`
- `v2.ads.get_product_recommended_roi_target`
- `v2.ads.get_ads_fácil_shop_rate`
- `v2.ads.check_create_gms_product_campaign_eligibility`
- `v2.ads.create_gms_product_campaign`
- `v2.ads.edit_gms_product_campaign`
- `v2.ads.list_gms_user_deleted_item`
- `v2.ads.edit_gms_item_product_campaign`
- `v2.ads.get_gms_campaign_performance`
- `v2.ads.get_gms_item_performance`

## 公共（Public）

- `v2.public.get_shops_by_partner`
- `v2.public.get_merchants_by_partner`
- `v2.public.get_access_token`
- `v2.public.refresh_access_token`
- `v2.public.get_token_by_resend_code`
- `v2.public.get_shopee_ip_ranges`

## 消息推送（Push）

- `v2.push.set_app_push_config`
- `v2.push.get_app_push_config`
- `v2.push.get_lost_push_message`
- `v2.push.confirm_consumed_lost_push_message`

## 官方仓与库存（SBS）

- `v2.sbs.get_bound_whs_info`
- `v2.sbs.get_current_inventory`
- `v2.sbs.get_expiry_report`
- `v2.sbs.get_stock_aging`
- `v2.sbs.get_stock_movement`
- `v2.sbs.get_fulfillment_mapping_inventory_list`

## 官方履约（巴西）（FBS）

- `v2.fbs.query_br_shop_enrollment_status`
- `v2.fbs.query_br_shop_invoice_error`
- `v2.fbs.query_br_shop_block_status`
- `v2.fbs.query_br_sku_block_status`

## 直播（Livestream）

- `v2.livestream.upload_image`
- `v2.livestream.create_session`
- `v2.livestream.update_session`
- `v2.livestream.start_session`
- `v2.livestream.end_session`
- `v2.livestream.get_session_detail`
- `v2.livestream.add_item_list`
- `v2.livestream.delete_item_list`
- `v2.livestream.update_item_list`
- `v2.livestream.get_item_count`
- `v2.livestream.get_item_list`
- `v2.livestream.update_show_item`
- `v2.livestream.delete_show_item`
- `v2.livestream.get_show_item`
- `v2.livestream.get_like_item_list`
- `v2.livestream.get_recent_item_list`
- `v2.livestream.get_item_set_list`
- `v2.livestream.get_item_set_item_list`
- `v2.livestream.apply_item_set`
- `v2.livestream.get_session_metric`
- `v2.livestream.get_session_item_metric`
- `v2.livestream.get_latest_comment_list`
- `v2.livestream.post_comment`
- `v2.livestream.ban_user_comment`
- `v2.livestream.unban_user_comment`

## 品牌门户（BrandPortal）

- `v2.principal.get_shop_sales_performance_detail`
- `v2.principal.get_principal_sales_performance_detail`
- `v2.principal.get_shop_affiliate_performance`
- `v2.principal.get_principal_affiliate_performance`
- `v2.principal.get_content_affiliate_performance`
- `v2.principal.get_shop_livestream_performance`
- `v2.principal.get_principal_livestream_performance`
- `v2.principal.get_session_livestream_performance`
- `v2.principal.get_shop_video_performance`
- `v2.principal.get_principal_video_performance`
- `v2.principal.get_clip_video_performance`
