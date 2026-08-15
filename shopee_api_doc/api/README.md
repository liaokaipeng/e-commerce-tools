# Shopee Open Platform API 参考目录（v2，中文版）

> 数据来源：`/doc/module?version=2`，抓取于 2026-08-15，共 30 个模块、454 个条目。
> 官方页面：<https://open.shopee.cn/documents>

说明：

- 接口名保持官方标识符（如 `v2.ams.get_open_campaign_added_product`）不变，仅模块名给出中文译名。
- 「指南总览」模块下为文档指南页（非 API），官方跳转链接形如 `/developer-guide?from=doc&id={条目编号}`。
- 接口官方页面 URL 形如 `/documents/v2/{api_name}?module={module_id}&type=1`。

## 模块总览

| 模块 | 中文名称 | 条目数 |
|---|---|---|
| [`Overview`](#指南总览overview) | 指南总览 | 10 |
| [`AMS`](#联盟营销ams) | 联盟营销 | 36 |
| [`Video`](#视频video) | 视频 | 15 |
| [`Product`](#商品product) | 商品 | 58 |
| [`GlobalProduct`](#全球商品globalproduct) | 全球商品 | 34 |
| [`MediaSpace`](#媒体空间mediaspace) | 媒体空间 | 6 |
| [`Media`](#媒体media) | 媒体 | 6 |
| [`Shop`](#店铺shop) | 店铺 | 9 |
| [`Merchant`](#商家merchant) | 商家 | 6 |
| [`Order`](#订单order) | 订单 | 22 |
| [`Logistics`](#物流logistics) | 物流 | 46 |
| [`FirstMile`](#首公里firstmile) | 首公里 | 16 |
| [`Payment`](#支付payment) | 支付 | 18 |
| [`Discount`](#折扣活动discount) | 折扣活动 | 12 |
| [`Bundle Deal`](#捆绑销售bundle-deal) | 捆绑销售 | 10 |
| [`Add-On Deal`](#加购优惠add-on-deal) | 加购优惠 | 14 |
| [`Voucher`](#优惠券voucher) | 优惠券 | 6 |
| [`ShopFlashSale`](#店铺闪购shopflashsale) | 店铺闪购 | 11 |
| [`Follow Prize`](#关注有礼follow-prize) | 关注有礼 | 6 |
| [`TopPicks`](#热门精选toppicks) | 热门精选 | 4 |
| [`ShopCategory`](#店铺分类shopcategory) | 店铺分类 | 7 |
| [`Returns`](#退货退款returns) | 退货退款 | 15 |
| [`AccountHealth`](#账户健康accounthealth) | 账户健康 | 6 |
| [`Ads`](#广告ads) | 广告 | 25 |
| [`Public`](#公共public) | 公共 | 6 |
| [`Push`](#消息推送push) | 消息推送 | 4 |
| [`SBS`](#官方仓与库存sbs) | 官方仓与库存 | 6 |
| [`FBS`](#官方履约巴西fbs) | 官方履约（巴西） | 4 |
| [`Livestream`](#直播livestream) | 直播 | 25 |
| [`BrandPortal`](#品牌门户brandportal) | 品牌门户 | 11 |

## 指南总览（Overview）

| 中文名称 | 官方名称 | 条目编号 | 官方跳转 |
|---|---|---|---|
| 介绍 | Introduction | 64 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=64) |
| OpenAPI 2.0 概览 | OpenAPI 2.0 Overview | 58 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=58) |
| OpenAPI 2.0 概览（中文版） | [中文版] OpenAPI 2.0 Overview | 65 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=65) |
| CNSC API 对接用户手册 | [中文版]CNSC API对接用户手册 | 69 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=69) |
| KRSC API 集成指南 | KRSC API Integration Guide | 74 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=74) |
| 开发者指南 | Developer Guide | 59 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=59) |
| API 调用流程 | API Call Flows | 60 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=60) |
| 开发者类型与应用类型 | Developer Types and APP Types | 61 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=61) |
| 数据定义 | Data Definition | 62 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=62) |
| 消息推送机制（WebHook） | Push Mechanism(WebHook) | 63 | [跳转](https://open.shopee.com/developer-guide?from=doc&id=63) |

## 联盟营销（AMS）

| 接口名 | 官方页面 |
|---|---|
| `v2.ams.get_open_campaign_added_product` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_open_campaign_added_product?module=127&type=1) |
| `v2.ams.get_open_campaign_not_added_product` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_open_campaign_not_added_product?module=127&type=1) |
| `v2.ams.batch_add_products_to_open_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.batch_add_products_to_open_campaign?module=127&type=1) |
| `v2.ams.add_all_products_to_open_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.add_all_products_to_open_campaign?module=127&type=1) |
| `v2.ams.get_auto_add_new_product_toggle_status` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_auto_add_new_product_toggle_status?module=127&type=1) |
| `v2.ams.update_auto_add_new_product_setting` | [页面](https://open.shopee.cn/documents/v2/v2.ams.update_auto_add_new_product_setting?module=127&type=1) |
| `v2.ams.batch_edit_products_open_campaign_setting` | [页面](https://open.shopee.cn/documents/v2/v2.ams.batch_edit_products_open_campaign_setting?module=127&type=1) |
| `v2.ams.edit_all_products_open_campaign_setting` | [页面](https://open.shopee.cn/documents/v2/v2.ams.edit_all_products_open_campaign_setting?module=127&type=1) |
| `v2.ams.batch_remove_products_open_campaign_setting` | [页面](https://open.shopee.cn/documents/v2/v2.ams.batch_remove_products_open_campaign_setting?module=127&type=1) |
| `v2.ams.remove_all_products_open_campaign_setting` | [页面](https://open.shopee.cn/documents/v2/v2.ams.remove_all_products_open_campaign_setting?module=127&type=1) |
| `v2.ams.get_open_campaign_batch_task_result` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_open_campaign_batch_task_result?module=127&type=1) |
| `v2.ams.get_optimization_suggestion_product` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_optimization_suggestion_product?module=127&type=1) |
| `v2.ams.batch_get_products_suggested_rate` | [页面](https://open.shopee.cn/documents/v2/v2.ams.batch_get_products_suggested_rate?module=127&type=1) |
| `v2.ams.get_shop_suggested_rate` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_shop_suggested_rate?module=127&type=1) |
| `v2.ams.get_targeted_campaign_addable_product_list` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_targeted_campaign_addable_product_list?module=127&type=1) |
| `v2.ams.get_recommended_affiliate_list` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_recommended_affiliate_list?module=127&type=1) |
| `v2.ams.get_managed_affiliate_list` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_managed_affiliate_list?module=127&type=1) |
| `v2.ams.query_affiliate_list` | [页面](https://open.shopee.cn/documents/v2/v2.ams.query_affiliate_list?module=127&type=1) |
| `v2.ams.create_new_targeted_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.create_new_targeted_campaign?module=127&type=1) |
| `v2.ams.get_targeted_campaign_list` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_targeted_campaign_list?module=127&type=1) |
| `v2.ams.get_targeted_campaign_settings` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_targeted_campaign_settings?module=127&type=1) |
| `v2.ams.update_basic_info_of_targeted_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.update_basic_info_of_targeted_campaign?module=127&type=1) |
| `v2.ams.edit_product_list_of_targeted_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.edit_product_list_of_targeted_campaign?module=127&type=1) |
| `v2.ams.edit_affiliate_list_of_targeted_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.edit_affiliate_list_of_targeted_campaign?module=127&type=1) |
| `v2.ams.terminate_targeted_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ams.terminate_targeted_campaign?module=127&type=1) |
| `v2.ams.get_performance_data_update_time` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_performance_data_update_time?module=127&type=1) |
| `v2.ams.get_shop_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_shop_performance?module=127&type=1) |
| `v2.ams.get_product_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_product_performance?module=127&type=1) |
| `v2.ams.get_affiliate_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_affiliate_performance?module=127&type=1) |
| `v2.ams.get_content_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_content_performance?module=127&type=1) |
| `v2.ams.get_campaign_key_metrics_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_campaign_key_metrics_performance?module=127&type=1) |
| `v2.ams.get_open_campaign_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_open_campaign_performance?module=127&type=1) |
| `v2.ams.get_targeted_campaign_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_targeted_campaign_performance?module=127&type=1) |
| `v2.ams.get_conversion_report` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_conversion_report?module=127&type=1) |
| `v2.ams.get_validation_list` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_validation_list?module=127&type=1) |
| `v2.ams.get_validation_report` | [页面](https://open.shopee.cn/documents/v2/v2.ams.get_validation_report?module=127&type=1) |

## 视频（Video）

| 接口名 | 官方页面 |
|---|---|
| `v2.video.get_cover_list` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_cover_list?module=129&type=1) |
| `v2.video.edit_video_info` | [页面](https://open.shopee.cn/documents/v2/v2.video.edit_video_info?module=129&type=1) |
| `v2.video.post_video` | [页面](https://open.shopee.cn/documents/v2/v2.video.post_video?module=129&type=1) |
| `v2.video.get_video_list` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_list?module=129&type=1) |
| `v2.video.get_video_detail` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_detail?module=129&type=1) |
| `v2.video.delete_video` | [页面](https://open.shopee.cn/documents/v2/v2.video.delete_video?module=129&type=1) |
| `v2.video.get_overview_performance` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_overview_performance?module=129&type=1) |
| `v2.video.get_metric_trend` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_metric_trend?module=129&type=1) |
| `v2.video.get_user_demographics` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_user_demographics?module=129&type=1) |
| `v2.video.get_video_performance_list` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_performance_list?module=129&type=1) |
| `v2.video.get_prodcut_performance_list` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_prodcut_performance_list?module=129&type=1) |
| `v2.video.get_video_detail_performance` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_detail_performance?module=129&type=1) |
| `v2.video.get_video_detail_metric_trend` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_detail_metric_trend?module=129&type=1) |
| `v2.video.get_video_detail_audience_distribution` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_detail_audience_distribution?module=129&type=1) |
| `v2.video.get_video_detail_product_performance` | [页面](https://open.shopee.cn/documents/v2/v2.video.get_video_detail_product_performance?module=129&type=1) |

## 商品（Product）

| 接口名 | 官方页面 |
|---|---|
| `v2.product.get_category` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_category?module=89&type=1) |
| `v2.product.get_attribute_tree` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_attribute_tree?module=89&type=1) |
| `v2.product.get_brand_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_brand_list?module=89&type=1) |
| `v2.product.get_item_limit` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_limit?module=89&type=1) |
| `v2.product.get_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_list?module=89&type=1) |
| `v2.product.get_item_base_info` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_base_info?module=89&type=1) |
| `v2.product.get_item_extra_info` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_extra_info?module=89&type=1) |
| `v2.product.add_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.add_item?module=89&type=1) |
| `v2.product.update_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_item?module=89&type=1) |
| `v2.product.delete_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.delete_item?module=89&type=1) |
| `v2.product.init_tier_variation` | [页面](https://open.shopee.cn/documents/v2/v2.product.init_tier_variation?module=89&type=1) |
| `v2.product.update_tier_variation` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_tier_variation?module=89&type=1) |
| `v2.product.get_model_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_model_list?module=89&type=1) |
| `v2.product.add_model` | [页面](https://open.shopee.cn/documents/v2/v2.product.add_model?module=89&type=1) |
| `v2.product.update_model` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_model?module=89&type=1) |
| `v2.product.delete_model` | [页面](https://open.shopee.cn/documents/v2/v2.product.delete_model?module=89&type=1) |
| `v2.product.unlist_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.unlist_item?module=89&type=1) |
| `v2.product.update_price` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_price?module=89&type=1) |
| `v2.product.update_stock` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_stock?module=89&type=1) |
| `v2.product.boost_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.boost_item?module=89&type=1) |
| `v2.product.get_boosted_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_boosted_list?module=89&type=1) |
| `v2.product.get_item_promotion` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_promotion?module=89&type=1) |
| `v2.product.update_sip_item_price` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_sip_item_price?module=89&type=1) |
| `v2.product.search_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.search_item?module=89&type=1) |
| `v2.product.get_comment` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_comment?module=89&type=1) |
| `v2.product.reply_comment` | [页面](https://open.shopee.cn/documents/v2/v2.product.reply_comment?module=89&type=1) |
| `v2.product.category_recommend` | [页面](https://open.shopee.cn/documents/v2/v2.product.category_recommend?module=89&type=1) |
| `v2.product.register_brand` | [页面](https://open.shopee.cn/documents/v2/v2.product.register_brand?module=89&type=1) |
| `v2.product.get_recommend_attribute` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_recommend_attribute?module=89&type=1) |
| `v2.product.get_weight_recommendation` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_weight_recommendation?module=89&type=1) |
| `v2.product.get_size_chart_list ` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_size_chart_list%20?module=89&type=1) |
| `v2.product.get_size_chart_detail` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_size_chart_detail?module=89&type=1) |
| `v2.product.get_item_violation_info` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_violation_info?module=89&type=1) |
| `v2.product.get_variations` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_variations?module=89&type=1) |
| `v2.product.get_all_vehicle_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_all_vehicle_list?module=89&type=1) |
| `v2.product.get_vehicle_list_by_compatibility_detail` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_vehicle_list_by_compatibility_detail?module=89&type=1) |
| `v2.product.get_item_content_diagnosis_result` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_content_diagnosis_result?module=89&type=1) |
| `v2.product.get_item_list_by_content_diagnosis` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_item_list_by_content_diagnosis?module=89&type=1) |
| `v2.product.get_kit_item_limit` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_kit_item_limit?module=89&type=1) |
| `v2.product.add_kit_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.add_kit_item?module=89&type=1) |
| `v2.product.update_kit_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.update_kit_item?module=89&type=1) |
| `v2.product.get_kit_item_info` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_kit_item_info?module=89&type=1) |
| `v2.product.get_aitem_by_pitem_id` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_aitem_by_pitem_id?module=89&type=1) |
| `v2.product.search_attribute_value_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.search_attribute_value_list?module=89&type=1) |
| `v2.product.get_main_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_main_item_list?module=89&type=1) |
| `v2.product.get_direct_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_direct_item_list?module=89&type=1) |
| `v2.product.get_direct_shop_recommended_price` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_direct_shop_recommended_price?module=89&type=1) |
| `v2.product.get_product_certification_rule` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_product_certification_rule?module=89&type=1) |
| ` v2.product.publish_item_to_outlet_shop` | [页面](https://open.shopee.cn/documents/v2/%20v2.product.publish_item_to_outlet_shop?module=89&type=1) |
| `v2.product.get_mart_item_mapping_by_id` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_mart_item_mapping_by_id?module=89&type=1) |
| `v2.product.search_unpackaged_model_list` | [页面](https://open.shopee.cn/documents/v2/v2.product.search_unpackaged_model_list?module=89&type=1) |
| `v2.product.generate_kit_image` | [页面](https://open.shopee.cn/documents/v2/v2.product.generate_kit_image?module=89&type=1) |
| `v2.product.get_mart_item_by_outlet_item_id` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_mart_item_by_outlet_item_id?module=89&type=1) |
| `v2.product.batch_update_outlet_price` | [页面](https://open.shopee.cn/documents/v2/v2.product.batch_update_outlet_price?module=89&type=1) |
| `v2.product.batch_update_outlet_stock` | [页面](https://open.shopee.cn/documents/v2/v2.product.batch_update_outlet_stock?module=89&type=1) |
| `v2.product.get_batch_task_result` | [页面](https://open.shopee.cn/documents/v2/v2.product.get_batch_task_result?module=89&type=1) |
| `v2.product.batch_add_item` | [页面](https://open.shopee.cn/documents/v2/v2.product.batch_add_item?module=89&type=1) |
| `v2.product.batch_publish_item_to_outlet_shop` | [页面](https://open.shopee.cn/documents/v2/v2.product.batch_publish_item_to_outlet_shop?module=89&type=1) |

## 全球商品（GlobalProduct）

| 接口名 | 官方页面 |
|---|---|
| `v2.global_product.get_category` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_category?module=90&type=1) |
| `v2.global_product.get_attribute_tree` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_attribute_tree?module=90&type=1) |
| `v2.global_product.get_brand_list` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_brand_list?module=90&type=1) |
| `v2.global_product.get_global_item_limit` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_global_item_limit?module=90&type=1) |
| `v2.global_product.get_global_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_global_item_list?module=90&type=1) |
| `v2.global_product.get_global_item_info` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_global_item_info?module=90&type=1) |
| `v2.global_product.add_global_item` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.add_global_item?module=90&type=1) |
| `v2.global_product.update_global_item` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_global_item?module=90&type=1) |
| `v2.global_product.delete_global_item` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.delete_global_item?module=90&type=1) |
| `v2.global_product.init_tier_variation` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.init_tier_variation?module=90&type=1) |
| `v2.global_product.update_tier_variation` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_tier_variation?module=90&type=1) |
| `v2.global_product.add_global_model` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.add_global_model?module=90&type=1) |
| `v2.global_product.update_global_model` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_global_model?module=90&type=1) |
| `v2.global_product.delete_global_model` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.delete_global_model?module=90&type=1) |
| `v2.global_product.get_global_model_list` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_global_model_list?module=90&type=1) |
| `v2.global_product.support_size_chart` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.support_size_chart?module=90&type=1) |
| `v2.global_product.update_size_chart` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_size_chart?module=90&type=1) |
| `v2.global_product.create_publish_task` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.create_publish_task?module=90&type=1) |
| `v2.global_product.get_publishable_shop` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_publishable_shop?module=90&type=1) |
| `v2.global_product.get_publish_task_result` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_publish_task_result?module=90&type=1) |
| `v2.global_product.get_published_list` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_published_list?module=90&type=1) |
| `v2.global_product.update_price` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_price?module=90&type=1) |
| `v2.global_product.update_stock` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_stock?module=90&type=1) |
| `v2.global_product.set_sync_field` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.set_sync_field?module=90&type=1) |
| `v2.global_product.get_global_item_id` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_global_item_id?module=90&type=1) |
| `v2.global_product.category_recommend` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.category_recommend?module=90&type=1) |
| `v2.global_product.get_recommend_attribute` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_recommend_attribute?module=90&type=1) |
| `v2.global_product.get_shop_publishable_status` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_shop_publishable_status?module=90&type=1) |
| `v2.global_product.get_variations` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_variations?module=90&type=1) |
| `v2.global_product.get_size_chart_detail` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_size_chart_detail?module=90&type=1) |
| `v2.global_product.get_size_chart_list ` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_size_chart_list%20?module=90&type=1) |
| `v2.global_product.search_global_attribute_value_list` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.search_global_attribute_value_list?module=90&type=1) |
| `v2.global_product.get_local_adjustment_rate` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.get_local_adjustment_rate?module=90&type=1) |
| `v2.global_product.update_local_adjustment_rate` | [页面](https://open.shopee.cn/documents/v2/v2.global_product.update_local_adjustment_rate?module=90&type=1) |

## 媒体空间（MediaSpace）

| 接口名 | 官方页面 |
|---|---|
| `v2.media_space.init_video_upload` | [页面](https://open.shopee.cn/documents/v2/v2.media_space.init_video_upload?module=91&type=1) |
| `v2.media_space.upload_video_part` | [页面](https://open.shopee.cn/documents/v2/v2.media_space.upload_video_part?module=91&type=1) |
| `v2.media_space.complete_video_upload` | [页面](https://open.shopee.cn/documents/v2/v2.media_space.complete_video_upload?module=91&type=1) |
| `v2.media_space.get_video_upload_result` | [页面](https://open.shopee.cn/documents/v2/v2.media_space.get_video_upload_result?module=91&type=1) |
| `v2.media_space.cancel_video_upload` | [页面](https://open.shopee.cn/documents/v2/v2.media_space.cancel_video_upload?module=91&type=1) |
| `v2.media_space.upload_image` | [页面](https://open.shopee.cn/documents/v2/v2.media_space.upload_image?module=91&type=1) |

## 媒体（Media）

| 接口名 | 官方页面 |
|---|---|
| `v2.media.upload_image` | [页面](https://open.shopee.cn/documents/v2/v2.media.upload_image?module=130&type=1) |
| `v2.media.init_video_upload` | [页面](https://open.shopee.cn/documents/v2/v2.media.init_video_upload?module=130&type=1) |
| `v2.media.upload_video_part` | [页面](https://open.shopee.cn/documents/v2/v2.media.upload_video_part?module=130&type=1) |
| `v2.media.complete_video_upload` | [页面](https://open.shopee.cn/documents/v2/v2.media.complete_video_upload?module=130&type=1) |
| `v2.media.get_video_upload_result` | [页面](https://open.shopee.cn/documents/v2/v2.media.get_video_upload_result?module=130&type=1) |
| `v2.media.cancel_video_upload` | [页面](https://open.shopee.cn/documents/v2/v2.media.cancel_video_upload?module=130&type=1) |

## 店铺（Shop）

| 接口名 | 官方页面 |
|---|---|
| `v2.shop.get_shop_info` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_shop_info?module=92&type=1) |
| `v2.shop.get_profile` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_profile?module=92&type=1) |
| `v2.shop.update_profile` | [页面](https://open.shopee.cn/documents/v2/v2.shop.update_profile?module=92&type=1) |
| `v2.shop.get_warehouse_detail` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_warehouse_detail?module=92&type=1) |
| `v2.shop.get_shop_notification` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_shop_notification?module=92&type=1) |
| `v2.shop.get_authorised_reseller_brand` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_authorised_reseller_brand?module=92&type=1) |
| `v2.shop.get_br_shop_onboarding_info` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_br_shop_onboarding_info?module=92&type=1) |
| `v2.shop.get_shop_holiday_mode` | [页面](https://open.shopee.cn/documents/v2/v2.shop.get_shop_holiday_mode?module=92&type=1) |
| `v2.shop.set_shop_holiday_mode` | [页面](https://open.shopee.cn/documents/v2/v2.shop.set_shop_holiday_mode?module=92&type=1) |

## 商家（Merchant）

| 接口名 | 官方页面 |
|---|---|
| `v2.merchant.get_merchant_info` | [页面](https://open.shopee.cn/documents/v2/v2.merchant.get_merchant_info?module=93&type=1) |
| `v2.merchant.get_shop_list_by_merchant` | [页面](https://open.shopee.cn/documents/v2/v2.merchant.get_shop_list_by_merchant?module=93&type=1) |
| `v2.merchant.get_merchant_warehouse_location_list` | [页面](https://open.shopee.cn/documents/v2/v2.merchant.get_merchant_warehouse_location_list?module=93&type=1) |
| `v2.merchant.get_merchant_warehouse_list` | [页面](https://open.shopee.cn/documents/v2/v2.merchant.get_merchant_warehouse_list?module=93&type=1) |
| `v2.merchant.get_warehouse_eligible_shop_list` | [页面](https://open.shopee.cn/documents/v2/v2.merchant.get_warehouse_eligible_shop_list?module=93&type=1) |
| `v2.merchant.get_merchant_prepaid_account_list` | [页面](https://open.shopee.cn/documents/v2/v2.merchant.get_merchant_prepaid_account_list?module=93&type=1) |

## 订单（Order）

| 接口名 | 官方页面 |
|---|---|
| `v2.order.get_order_list` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_order_list?module=94&type=1) |
| `v2.order.get_order_detail` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_order_detail?module=94&type=1) |
| `v2.order.get_shipment_list` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_shipment_list?module=94&type=1) |
| `v2.order.search_package_list` | [页面](https://open.shopee.cn/documents/v2/v2.order.search_package_list?module=94&type=1) |
| `v2.order.get_package_detail` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_package_detail?module=94&type=1) |
| `v2.order.split_order` | [页面](https://open.shopee.cn/documents/v2/v2.order.split_order?module=94&type=1) |
| `v2.order.unsplit_order` | [页面](https://open.shopee.cn/documents/v2/v2.order.unsplit_order?module=94&type=1) |
| `v2.order.cancel_order` | [页面](https://open.shopee.cn/documents/v2/v2.order.cancel_order?module=94&type=1) |
| `v2.order.handle_buyer_cancellation` | [页面](https://open.shopee.cn/documents/v2/v2.order.handle_buyer_cancellation?module=94&type=1) |
| `v2.order.set_note` | [页面](https://open.shopee.cn/documents/v2/v2.order.set_note?module=94&type=1) |
| `v2.order.get_pending_buyer_invoice_order_list` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_pending_buyer_invoice_order_list?module=94&type=1) |
| `v2.order.get_buyer_invoice_info` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_buyer_invoice_info?module=94&type=1) |
| `v2.order.upload_invoice_doc` | [页面](https://open.shopee.cn/documents/v2/v2.order.upload_invoice_doc?module=94&type=1) |
| `v2.order.download_invoice_doc` | [页面](https://open.shopee.cn/documents/v2/v2.order.download_invoice_doc?module=94&type=1) |
| `v2.order.handle_prescription_check` | [页面](https://open.shopee.cn/documents/v2/v2.order.handle_prescription_check?module=94&type=1) |
| `v2.order.get_warehouse_filter_config` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_warehouse_filter_config?module=94&type=1) |
| `v2.order.get_booking_list` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_booking_list?module=94&type=1) |
| `v2.order.get_booking_detail` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_booking_detail?module=94&type=1) |
| `v2.order.generate_fbs_invoices` | [页面](https://open.shopee.cn/documents/v2/v2.order.generate_fbs_invoices?module=94&type=1) |
| `v2.order.get_fbs_invoices_result` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_fbs_invoices_result?module=94&type=1) |
| `v2.order.download_fbs_invoices` | [页面](https://open.shopee.cn/documents/v2/v2.order.download_fbs_invoices?module=94&type=1) |
| `v2.order.get_estimate_cancel_value` | [页面](https://open.shopee.cn/documents/v2/v2.order.get_estimate_cancel_value?module=94&type=1) |

## 物流（Logistics）

| 接口名 | 官方页面 |
|---|---|
| `v2.logistics.get_shipping_parameter` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_shipping_parameter?module=95&type=1) |
| `v2.logistics.get_mass_shipping_parameter` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_mass_shipping_parameter?module=95&type=1) |
| `v2.logistics.ship_order` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.ship_order?module=95&type=1) |
| `v2.logistics.mass_ship_order` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.mass_ship_order?module=95&type=1) |
| `v2.logistics.update_shipping_order` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.update_shipping_order?module=95&type=1) |
| `v2.logistics.get_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_tracking_number?module=95&type=1) |
| `v2.logistics.get_mass_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_mass_tracking_number?module=95&type=1) |
| `v2.logistics.get_shipping_document_parameter` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_shipping_document_parameter?module=95&type=1) |
| `v2.logistics.create_shipping_document` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.create_shipping_document?module=95&type=1) |
| `v2.logistics.get_shipping_document_result` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_shipping_document_result?module=95&type=1) |
| `v2.logistics.download_shipping_document` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.download_shipping_document?module=95&type=1) |
| `v2.logistics.get_shipping_document_data_info` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_shipping_document_data_info?module=95&type=1) |
| `v2.logistics.get_tracking_info` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_tracking_info?module=95&type=1) |
| `v2.logistics.get_address_list` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_address_list?module=95&type=1) |
| `v2.logistics.set_address_config` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.set_address_config?module=95&type=1) |
| `v2.logistics.update_address` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.update_address?module=95&type=1) |
| `v2.logistics.delete_address` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.delete_address?module=95&type=1) |
| `v2.logistics.get_channel_list` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_channel_list?module=95&type=1) |
| `v2.logistics.update_channel` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.update_channel?module=95&type=1) |
| `v2.logistics.get_operating_hours` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_operating_hours?module=95&type=1) |
| `v2.logistics.get_operating_hour_restrictions` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_operating_hour_restrictions?module=95&type=1) |
| `v2.logistics.update_operating_hours` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.update_operating_hours?module=95&type=1) |
| `v2.logistics.delete_special_operating_hour` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.delete_special_operating_hour?module=95&type=1) |
| `v2.logistics.batch_update_tpf_warehouse_tracking_status` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.batch_update_tpf_warehouse_tracking_status?module=95&type=1) |
| `v2.logistics.batch_ship_order` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.batch_ship_order?module=95&type=1) |
| `v2.logistics.update_tracking_status` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.update_tracking_status?module=95&type=1) |
| `v2.logistics.get_booking_shipping_parameter` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_booking_shipping_parameter?module=95&type=1) |
| `v2.logistics.ship_booking` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.ship_booking?module=95&type=1) |
| `v2.logistics.get_booking_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_booking_tracking_number?module=95&type=1) |
| `v2.logistics.get_booking_shipping_document_parameter` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_booking_shipping_document_parameter?module=95&type=1) |
| `v2.logistics.create_booking_shipping_document` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.create_booking_shipping_document?module=95&type=1) |
| `v2.logistics.get_booking_shipping_document_result` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_booking_shipping_document_result?module=95&type=1) |
| `v2.logistics.download_booking_shipping_document` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.download_booking_shipping_document?module=95&type=1) |
| `v2.logistics.get_booking_shipping_document_data_info` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_booking_shipping_document_data_info?module=95&type=1) |
| `v2.logistics.get_booking_tracking_info` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_booking_tracking_info?module=95&type=1) |
| `v2.logistics.download_to_label` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.download_to_label?module=95&type=1) |
| `v2.logistics.create_shipping_document_job` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.create_shipping_document_job?module=95&type=1) |
| `v2.logistics.get_shipping_document_job_status` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_shipping_document_job_status?module=95&type=1) |
| `v2.logistics.download_shipping_document_job` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.download_shipping_document_job?module=95&type=1) |
| `v2.logistics.update_self_collection_order_logistics` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.update_self_collection_order_logistics?module=95&type=1) |
| `v2.logistics.get_mart_packaging_info` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_mart_packaging_info?module=95&type=1) |
| `v2.logistics.set_mart_packaging_info` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.set_mart_packaging_info?module=95&type=1) |
| `v2.logistics.upload_serviceable_polygon` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.upload_serviceable_polygon?module=95&type=1) |
| `v2.logistics.check_polygon_update_status` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.check_polygon_update_status?module=95&type=1) |
| `v2.logistics.get_pause_status` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.get_pause_status?module=95&type=1) |
| `v2.logistics.set_pause_status` | [页面](https://open.shopee.cn/documents/v2/v2.logistics.set_pause_status?module=95&type=1) |

## 首公里（FirstMile）

| 接口名 | 官方页面 |
|---|---|
| `v2.first_mile.get_unbind_order_list` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_unbind_order_list?module=96&type=1) |
| `v2.first_mile.get_detail` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_detail?module=96&type=1) |
| `v2.first_mile.generate_first_mile_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.generate_first_mile_tracking_number?module=96&type=1) |
| `v2.first_mile.bind_first_mile_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.bind_first_mile_tracking_number?module=96&type=1) |
| `v2.first_mile.unbind_first_mile_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.unbind_first_mile_tracking_number?module=96&type=1) |
| `v2.first_mile.get_tracking_number_list` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_tracking_number_list?module=96&type=1) |
| `v2.first_mile.get_waybill` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_waybill?module=96&type=1) |
| `v2.first_mile.get_channel_list` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_channel_list?module=96&type=1) |
| `v2.first_mile.get_courier_delivery_channel_list` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_courier_delivery_channel_list?module=96&type=1) |
| `v2.first_mile.get_transit_warehouse_list` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_transit_warehouse_list?module=96&type=1) |
| `v2.first_mile.generate_and_bind_first_mile_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.generate_and_bind_first_mile_tracking_number?module=96&type=1) |
| `v2.first_mile.bind_courier_delivery_first_mile_tracking_number` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.bind_courier_delivery_first_mile_tracking_number?module=96&type=1) |
| `v2.first_mile.unbind_first_mile_tracking_number_all` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.unbind_first_mile_tracking_number_all?module=96&type=1) |
| `v2.first_mile.get_courier_delivery_detail` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_courier_delivery_detail?module=96&type=1) |
| `v2.first_mile.get_courier_delivery_waybill` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_courier_delivery_waybill?module=96&type=1) |
| `v2.first_mile.get_courier_delivery_tracking_number_list` | [页面](https://open.shopee.cn/documents/v2/v2.first_mile.get_courier_delivery_tracking_number_list?module=96&type=1) |

## 支付（Payment）

| 接口名 | 官方页面 |
|---|---|
| `v2.payment.get_escrow_detail` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_escrow_detail?module=97&type=1) |
| `v2.payment.set_shop_installment_status` | [页面](https://open.shopee.cn/documents/v2/v2.payment.set_shop_installment_status?module=97&type=1) |
| `v2.payment.get_shop_installment_status` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_shop_installment_status?module=97&type=1) |
| `v2.payment.get_payout_detail` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_payout_detail?module=97&type=1) |
| `v2.payment.set_item_installment_status` | [页面](https://open.shopee.cn/documents/v2/v2.payment.set_item_installment_status?module=97&type=1) |
| `v2.payment.get_item_installment_status` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_item_installment_status?module=97&type=1) |
| `v2.payment.get_payment_method_list` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_payment_method_list?module=97&type=1) |
| `v2.payment.get_wallet_transaction_list` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_wallet_transaction_list?module=97&type=1) |
| `v2.payment.get_escrow_list` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_escrow_list?module=97&type=1) |
| `v2.payment.get_payout_info` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_payout_info?module=97&type=1) |
| `v2.payment.get_billing_transaction_info` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_billing_transaction_info?module=97&type=1) |
| `v2.payment.get_escrow_detail_batch` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_escrow_detail_batch?module=97&type=1) |
| `v2.payment.generate_income_statement` | [页面](https://open.shopee.cn/documents/v2/v2.payment.generate_income_statement?module=97&type=1) |
| `v2.payment.get_income_statement` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_income_statement?module=97&type=1) |
| `v2.payment.generate_income_report` | [页面](https://open.shopee.cn/documents/v2/v2.payment.generate_income_report?module=97&type=1) |
| `v2.payment.get_income_report` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_income_report?module=97&type=1) |
| `v2.payment.get_income_overview` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_income_overview?module=97&type=1) |
| `v2.payment.get_income_detail` | [页面](https://open.shopee.cn/documents/v2/v2.payment.get_income_detail?module=97&type=1) |

## 折扣活动（Discount）

| 接口名 | 官方页面 |
|---|---|
| `v2.discount.add_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.add_discount?module=99&type=1) |
| `v2.discount.add_discount_item` | [页面](https://open.shopee.cn/documents/v2/v2.discount.add_discount_item?module=99&type=1) |
| `v2.discount.delete_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.delete_discount?module=99&type=1) |
| `v2.discount.delete_discount_item` | [页面](https://open.shopee.cn/documents/v2/v2.discount.delete_discount_item?module=99&type=1) |
| `v2.discount.get_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.get_discount?module=99&type=1) |
| `v2.discount.get_discount_list` | [页面](https://open.shopee.cn/documents/v2/v2.discount.get_discount_list?module=99&type=1) |
| `v2.discount.update_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.update_discount?module=99&type=1) |
| `v2.discount.update_discount_item` | [页面](https://open.shopee.cn/documents/v2/v2.discount.update_discount_item?module=99&type=1) |
| `v2.discount.end_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.end_discount?module=99&type=1) |
| `v2.discount.get_sip_discounts` | [页面](https://open.shopee.cn/documents/v2/v2.discount.get_sip_discounts?module=99&type=1) |
| `v2.discount.set_sip_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.set_sip_discount?module=99&type=1) |
| `v2.discount.delete_sip_discount` | [页面](https://open.shopee.cn/documents/v2/v2.discount.delete_sip_discount?module=99&type=1) |

## 捆绑销售（Bundle Deal）

| 接口名 | 官方页面 |
|---|---|
| `v2.bundle_deal.add_bundle_deal` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.add_bundle_deal?module=110&type=1) |
| `v2.bundle_deal.add_bundle_deal_item` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.add_bundle_deal_item?module=110&type=1) |
| `v2.bundle_deal.get_bundle_deal_list` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.get_bundle_deal_list?module=110&type=1) |
| `v2.bundle_deal.get_bundle_deal` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.get_bundle_deal?module=110&type=1) |
| `v2.bundle_deal.get_bundle_deal_item` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.get_bundle_deal_item?module=110&type=1) |
| `v2.bundle_deal.update_bundle_deal` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.update_bundle_deal?module=110&type=1) |
| `v2.bundle_deal.update_bundle_deal_item` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.update_bundle_deal_item?module=110&type=1) |
| `v2.bundle_deal.end_bundle_deal` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.end_bundle_deal?module=110&type=1) |
| `v2.bundle_deal.delete_bundle_deal` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.delete_bundle_deal?module=110&type=1) |
| `v2.bundle_deal.delete_bundle_deal_item` | [页面](https://open.shopee.cn/documents/v2/v2.bundle_deal.delete_bundle_deal_item?module=110&type=1) |

## 加购优惠（Add-On Deal）

| 接口名 | 官方页面 |
|---|---|
| `v2.add_on_deal.add_add_on_deal` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.add_add_on_deal?module=111&type=1) |
| `v2.add_on_deal.add_add_on_deal_main_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.add_add_on_deal_main_item?module=111&type=1) |
| `v2.add_on_deal.add_add_on_deal_sub_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.add_add_on_deal_sub_item?module=111&type=1) |
| `v2.add_on_deal.delete_add_on_deal` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.delete_add_on_deal?module=111&type=1) |
| `v2.add_on_deal.delete_add_on_deal_main_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.delete_add_on_deal_main_item?module=111&type=1) |
| `v2.add_on_deal.delete_add_on_deal_sub_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.delete_add_on_deal_sub_item?module=111&type=1) |
| `v2.add_on_deal.get_add_on_deal_list` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.get_add_on_deal_list?module=111&type=1) |
| `v2.add_on_deal.get_add_on_deal` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.get_add_on_deal?module=111&type=1) |
| `v2.add_on_deal.get_add_on_deal_main_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.get_add_on_deal_main_item?module=111&type=1) |
| `v2.add_on_deal.get_add_on_deal_sub_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.get_add_on_deal_sub_item?module=111&type=1) |
| `v2.add_on_deal.update_add_on_deal` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.update_add_on_deal?module=111&type=1) |
| `v2.add_on_deal.update_add_on_deal_main_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.update_add_on_deal_main_item?module=111&type=1) |
| `v2.add_on_deal.update_add_on_deal_sub_item` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.update_add_on_deal_sub_item?module=111&type=1) |
| `v2.add_on_deal.end_add_on_deal` | [页面](https://open.shopee.cn/documents/v2/v2.add_on_deal.end_add_on_deal?module=111&type=1) |

## 优惠券（Voucher）

| 接口名 | 官方页面 |
|---|---|
| `v2.voucher.add_voucher` | [页面](https://open.shopee.cn/documents/v2/v2.voucher.add_voucher?module=112&type=1) |
| `v2.voucher.delete_voucher` | [页面](https://open.shopee.cn/documents/v2/v2.voucher.delete_voucher?module=112&type=1) |
| `v2.voucher.end_voucher` | [页面](https://open.shopee.cn/documents/v2/v2.voucher.end_voucher?module=112&type=1) |
| `v2.voucher.update_voucher` | [页面](https://open.shopee.cn/documents/v2/v2.voucher.update_voucher?module=112&type=1) |
| `v2.voucher.get_voucher` | [页面](https://open.shopee.cn/documents/v2/v2.voucher.get_voucher?module=112&type=1) |
| `v2.voucher.get_voucher_list` | [页面](https://open.shopee.cn/documents/v2/v2.voucher.get_voucher_list?module=112&type=1) |

## 店铺闪购（ShopFlashSale）

| 接口名 | 官方页面 |
|---|---|
| `v2.shop_flash_sale.get_time_slot_id` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.get_time_slot_id?module=123&type=1) |
| `v2.shop_flash_sale.create_shop_flash_sale` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.create_shop_flash_sale?module=123&type=1) |
| `v2.shop_flash_sale.get_item_criteria` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.get_item_criteria?module=123&type=1) |
| `v2.shop_flash_sale.add_shop_flash_sale_items` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.add_shop_flash_sale_items?module=123&type=1) |
| `v2.shop_flash_sale.get_shop_flash_sale_list` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.get_shop_flash_sale_list?module=123&type=1) |
| `v2.shop_flash_sale.get_shop_flash_sale` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.get_shop_flash_sale?module=123&type=1) |
| `v2.shop_flash_sale.get_shop_flash_sale_items` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.get_shop_flash_sale_items?module=123&type=1) |
| `v2.shop_flash_sale.update_shop_flash_sale` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.update_shop_flash_sale?module=123&type=1) |
| `v2.shop_flash_sale.update_shop_flash_sale_items` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.update_shop_flash_sale_items?module=123&type=1) |
| `v2.shop_flash_sale.delete_shop_flash_sale` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.delete_shop_flash_sale?module=123&type=1) |
| `v2.shop_flash_sale.delete_shop_flash_sale_items` | [页面](https://open.shopee.cn/documents/v2/v2.shop_flash_sale.delete_shop_flash_sale_items?module=123&type=1) |

## 关注有礼（Follow Prize）

| 接口名 | 官方页面 |
|---|---|
| `v2.follow_prize.add_follow_prize` | [页面](https://open.shopee.cn/documents/v2/v2.follow_prize.add_follow_prize?module=113&type=1) |
| `v2.follow_prize.delete_follow_prize` | [页面](https://open.shopee.cn/documents/v2/v2.follow_prize.delete_follow_prize?module=113&type=1) |
| `v2.follow_prize.end_follow_prize` | [页面](https://open.shopee.cn/documents/v2/v2.follow_prize.end_follow_prize?module=113&type=1) |
| `v2.follow_prize.update_follow_prize` | [页面](https://open.shopee.cn/documents/v2/v2.follow_prize.update_follow_prize?module=113&type=1) |
| `v2.follow_prize.get_follow_prize_detail` | [页面](https://open.shopee.cn/documents/v2/v2.follow_prize.get_follow_prize_detail?module=113&type=1) |
| `v2.follow_prize.get_follow_prize_list` | [页面](https://open.shopee.cn/documents/v2/v2.follow_prize.get_follow_prize_list?module=113&type=1) |

## 热门精选（TopPicks）

| 接口名 | 官方页面 |
|---|---|
| `v2.top_picks.get_top_picks_list` | [页面](https://open.shopee.cn/documents/v2/v2.top_picks.get_top_picks_list?module=100&type=1) |
| `v2.top_picks.add_top_picks` | [页面](https://open.shopee.cn/documents/v2/v2.top_picks.add_top_picks?module=100&type=1) |
| `v2.top_picks.update_top_picks` | [页面](https://open.shopee.cn/documents/v2/v2.top_picks.update_top_picks?module=100&type=1) |
| `v2.top_picks.delete_top_picks` | [页面](https://open.shopee.cn/documents/v2/v2.top_picks.delete_top_picks?module=100&type=1) |

## 店铺分类（ShopCategory）

| 接口名 | 官方页面 |
|---|---|
| `v2.shop_category.add_shop_category` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.add_shop_category?module=101&type=1) |
| `v2.shop_category.get_shop_category_list` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.get_shop_category_list?module=101&type=1) |
| `v2.shop_category.delete_shop_category` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.delete_shop_category?module=101&type=1) |
| `v2.shop_category.update_shop_category` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.update_shop_category?module=101&type=1) |
| `v2.shop_category.add_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.add_item_list?module=101&type=1) |
| `v2.shop_category.get_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.get_item_list?module=101&type=1) |
| `v2.shop_category.delete_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.shop_category.delete_item_list?module=101&type=1) |

## 退货退款（Returns）

| 接口名 | 官方页面 |
|---|---|
| `v2.returns.get_return_list` | [页面](https://open.shopee.cn/documents/v2/v2.returns.get_return_list?module=102&type=1) |
| `v2.returns.get_return_detail` | [页面](https://open.shopee.cn/documents/v2/v2.returns.get_return_detail?module=102&type=1) |
| `v2.returns.confirm` | [页面](https://open.shopee.cn/documents/v2/v2.returns.confirm?module=102&type=1) |
| `v2.returns.dispute` | [页面](https://open.shopee.cn/documents/v2/v2.returns.dispute?module=102&type=1) |
| `v2.returns.get_available_solutions` | [页面](https://open.shopee.cn/documents/v2/v2.returns.get_available_solutions?module=102&type=1) |
| `v2.returns.offer` | [页面](https://open.shopee.cn/documents/v2/v2.returns.offer?module=102&type=1) |
| `v2.returns.accept_offer` | [页面](https://open.shopee.cn/documents/v2/v2.returns.accept_offer?module=102&type=1) |
| `v2.returns.convert_image` | [页面](https://open.shopee.cn/documents/v2/v2.returns.convert_image?module=102&type=1) |
| `v2.returns.upload_proof` | [页面](https://open.shopee.cn/documents/v2/v2.returns.upload_proof?module=102&type=1) |
| `v2.returns.query_proof` | [页面](https://open.shopee.cn/documents/v2/v2.returns.query_proof?module=102&type=1) |
| `v2.returns.get_return_dispute_reason` | [页面](https://open.shopee.cn/documents/v2/v2.returns.get_return_dispute_reason?module=102&type=1) |
| `v2.returns.cancel_dispute` | [页面](https://open.shopee.cn/documents/v2/v2.returns.cancel_dispute?module=102&type=1) |
| `v2.returns.get_shipping_carrier` | [页面](https://open.shopee.cn/documents/v2/v2.returns.get_shipping_carrier?module=102&type=1) |
| `v2.returns.upload_shipping_proof` | [页面](https://open.shopee.cn/documents/v2/v2.returns.upload_shipping_proof?module=102&type=1) |
| `v2.returns.get_reverse_tracking_info` | [页面](https://open.shopee.cn/documents/v2/v2.returns.get_reverse_tracking_info?module=102&type=1) |

## 账户健康（AccountHealth）

| 接口名 | 官方页面 |
|---|---|
| `v2.account_health.get_shop_performance` | [页面](https://open.shopee.cn/documents/v2/v2.account_health.get_shop_performance?module=103&type=1) |
| `v2.account_health.get_metric_source_detail` | [页面](https://open.shopee.cn/documents/v2/v2.account_health.get_metric_source_detail?module=103&type=1) |
| `v2.account_health.get_penalty_point_history` | [页面](https://open.shopee.cn/documents/v2/v2.account_health.get_penalty_point_history?module=103&type=1) |
| `v2.account_health.get_punishment_history` | [页面](https://open.shopee.cn/documents/v2/v2.account_health.get_punishment_history?module=103&type=1) |
| `v2.account_health.get_listings_with_issues` | [页面](https://open.shopee.cn/documents/v2/v2.account_health.get_listings_with_issues?module=103&type=1) |
| `v2.account_health.get_late_orders` | [页面](https://open.shopee.cn/documents/v2/v2.account_health.get_late_orders?module=103&type=1) |

## 广告（Ads）

| 接口名 | 官方页面 |
|---|---|
| `v2.ads.get_total_balance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_total_balance?module=117&type=1) |
| `v2.ads.get_shop_toggle_info` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_shop_toggle_info?module=117&type=1) |
| `v2.ads.get_recommended_keyword_list` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_recommended_keyword_list?module=117&type=1) |
| `v2.ads.get_recommended_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_recommended_item_list?module=117&type=1) |
| `v2.ads.get_all_cpc_ads_hourly_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_all_cpc_ads_hourly_performance?module=117&type=1) |
| `v2.ads.get_all_cpc_ads_daily_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_all_cpc_ads_daily_performance?module=117&type=1) |
| `(coming offline soon) v2.ads.create_auto_product_ads` | [页面](https://open.shopee.cn/documents/v2/(coming%20offline%20soon)%20v2.ads.create_auto_product_ads?module=117&type=1) |
| `(coming offline soon) v2.ads.edit_auto_product_ads` | [页面](https://open.shopee.cn/documents/v2/(coming%20offline%20soon)%20v2.ads.edit_auto_product_ads?module=117&type=1) |
| `v2.ads.get_product_campaign_daily_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_product_campaign_daily_performance?module=117&type=1) |
| `v2.ads.get_product_campaign_hourly_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_product_campaign_hourly_performance?module=117&type=1) |
| `v2.ads.get_product_level_campaign_id_list` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_product_level_campaign_id_list?module=117&type=1) |
| `v2.ads.get_product_level_campaign_setting_info` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_product_level_campaign_setting_info?module=117&type=1) |
| `v2.ads.create_manual_product_ads` | [页面](https://open.shopee.cn/documents/v2/v2.ads.create_manual_product_ads?module=117&type=1) |
| `v2.ads.edit_manual_product_ad_keywords` | [页面](https://open.shopee.cn/documents/v2/v2.ads.edit_manual_product_ad_keywords?module=117&type=1) |
| `v2.ads.edit_manual_product_ads` | [页面](https://open.shopee.cn/documents/v2/v2.ads.edit_manual_product_ads?module=117&type=1) |
| `v2.ads.get_create_product_ad_budget_suggestion` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_create_product_ad_budget_suggestion?module=117&type=1) |
| `v2.ads.get_product_recommended_roi_target` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_product_recommended_roi_target?module=117&type=1) |
| `v2.ads.get_ads_fácil_shop_rate` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_ads_f%C3%A1cil_shop_rate?module=117&type=1) |
| `v2.ads.check_create_gms_product_campaign_eligibility` | [页面](https://open.shopee.cn/documents/v2/v2.ads.check_create_gms_product_campaign_eligibility?module=117&type=1) |
| `v2.ads.create_gms_product_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ads.create_gms_product_campaign?module=117&type=1) |
| `v2.ads.edit_gms_product_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ads.edit_gms_product_campaign?module=117&type=1) |
| `v2.ads.list_gms_user_deleted_item` | [页面](https://open.shopee.cn/documents/v2/v2.ads.list_gms_user_deleted_item?module=117&type=1) |
| `v2.ads.edit_gms_item_product_campaign` | [页面](https://open.shopee.cn/documents/v2/v2.ads.edit_gms_item_product_campaign?module=117&type=1) |
| `v2.ads.get_gms_campaign_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_gms_campaign_performance?module=117&type=1) |
| `v2.ads.get_gms_item_performance` | [页面](https://open.shopee.cn/documents/v2/v2.ads.get_gms_item_performance?module=117&type=1) |

## 公共（Public）

| 接口名 | 官方页面 |
|---|---|
| `v2.public.get_shops_by_partner` | [页面](https://open.shopee.cn/documents/v2/v2.public.get_shops_by_partner?module=104&type=1) |
| `v2.public.get_merchants_by_partner` | [页面](https://open.shopee.cn/documents/v2/v2.public.get_merchants_by_partner?module=104&type=1) |
| `v2.public.get_access_token` | [页面](https://open.shopee.cn/documents/v2/v2.public.get_access_token?module=104&type=1) |
| `v2.public.refresh_access_token` | [页面](https://open.shopee.cn/documents/v2/v2.public.refresh_access_token?module=104&type=1) |
| `v2.public.get_token_by_resend_code` | [页面](https://open.shopee.cn/documents/v2/v2.public.get_token_by_resend_code?module=104&type=1) |
| `v2.public.get_shopee_ip_ranges` | [页面](https://open.shopee.cn/documents/v2/v2.public.get_shopee_ip_ranges?module=104&type=1) |

## 消息推送（Push）

| 接口名 | 官方页面 |
|---|---|
| `v2.push.set_app_push_config` | [页面](https://open.shopee.cn/documents/v2/v2.push.set_app_push_config?module=105&type=1) |
| `v2.push.get_app_push_config` | [页面](https://open.shopee.cn/documents/v2/v2.push.get_app_push_config?module=105&type=1) |
| `v2.push.get_lost_push_message` | [页面](https://open.shopee.cn/documents/v2/v2.push.get_lost_push_message?module=105&type=1) |
| `v2.push.confirm_consumed_lost_push_message` | [页面](https://open.shopee.cn/documents/v2/v2.push.confirm_consumed_lost_push_message?module=105&type=1) |

## 官方仓与库存（SBS）

| 接口名 | 官方页面 |
|---|---|
| `v2.sbs.get_bound_whs_info` | [页面](https://open.shopee.cn/documents/v2/v2.sbs.get_bound_whs_info?module=124&type=1) |
| `v2.sbs.get_current_inventory` | [页面](https://open.shopee.cn/documents/v2/v2.sbs.get_current_inventory?module=124&type=1) |
| `v2.sbs.get_expiry_report` | [页面](https://open.shopee.cn/documents/v2/v2.sbs.get_expiry_report?module=124&type=1) |
| `v2.sbs.get_stock_aging` | [页面](https://open.shopee.cn/documents/v2/v2.sbs.get_stock_aging?module=124&type=1) |
| `v2.sbs.get_stock_movement` | [页面](https://open.shopee.cn/documents/v2/v2.sbs.get_stock_movement?module=124&type=1) |
| `v2.sbs.get_fulfillment_mapping_inventory_list` | [页面](https://open.shopee.cn/documents/v2/v2.sbs.get_fulfillment_mapping_inventory_list?module=124&type=1) |

## 官方履约（巴西）（FBS）

| 接口名 | 官方页面 |
|---|---|
| `v2.fbs.query_br_shop_enrollment_status` | [页面](https://open.shopee.cn/documents/v2/v2.fbs.query_br_shop_enrollment_status?module=126&type=1) |
| `v2.fbs.query_br_shop_invoice_error` | [页面](https://open.shopee.cn/documents/v2/v2.fbs.query_br_shop_invoice_error?module=126&type=1) |
| `v2.fbs.query_br_shop_block_status` | [页面](https://open.shopee.cn/documents/v2/v2.fbs.query_br_shop_block_status?module=126&type=1) |
| `v2.fbs.query_br_sku_block_status` | [页面](https://open.shopee.cn/documents/v2/v2.fbs.query_br_sku_block_status?module=126&type=1) |

## 直播（Livestream）

| 接口名 | 官方页面 |
|---|---|
| `v2.livestream.upload_image` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.upload_image?module=125&type=1) |
| `v2.livestream.create_session` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.create_session?module=125&type=1) |
| `v2.livestream.update_session` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.update_session?module=125&type=1) |
| `v2.livestream.start_session` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.start_session?module=125&type=1) |
| `v2.livestream.end_session` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.end_session?module=125&type=1) |
| `v2.livestream.get_session_detail` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_session_detail?module=125&type=1) |
| `v2.livestream.add_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.add_item_list?module=125&type=1) |
| `v2.livestream.delete_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.delete_item_list?module=125&type=1) |
| `v2.livestream.update_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.update_item_list?module=125&type=1) |
| `v2.livestream.get_item_count` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_item_count?module=125&type=1) |
| `v2.livestream.get_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_item_list?module=125&type=1) |
| `v2.livestream.update_show_item` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.update_show_item?module=125&type=1) |
| `v2.livestream.delete_show_item` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.delete_show_item?module=125&type=1) |
| `v2.livestream.get_show_item` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_show_item?module=125&type=1) |
| `v2.livestream.get_like_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_like_item_list?module=125&type=1) |
| `v2.livestream.get_recent_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_recent_item_list?module=125&type=1) |
| `v2.livestream.get_item_set_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_item_set_list?module=125&type=1) |
| `v2.livestream.get_item_set_item_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_item_set_item_list?module=125&type=1) |
| `v2.livestream.apply_item_set` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.apply_item_set?module=125&type=1) |
| `v2.livestream.get_session_metric` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_session_metric?module=125&type=1) |
| `v2.livestream.get_session_item_metric` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_session_item_metric?module=125&type=1) |
| `v2.livestream.get_latest_comment_list` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.get_latest_comment_list?module=125&type=1) |
| `v2.livestream.post_comment` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.post_comment?module=125&type=1) |
| `v2.livestream.ban_user_comment` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.ban_user_comment?module=125&type=1) |
| `v2.livestream.unban_user_comment` | [页面](https://open.shopee.cn/documents/v2/v2.livestream.unban_user_comment?module=125&type=1) |

## 品牌门户（BrandPortal）

| 接口名 | 官方页面 |
|---|---|
| `v2.principal.get_shop_sales_performance_detail` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_shop_sales_performance_detail?module=139&type=1) |
| `v2.principal.get_principal_sales_performance_detail` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_principal_sales_performance_detail?module=139&type=1) |
| `v2.principal.get_shop_affiliate_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_shop_affiliate_performance?module=139&type=1) |
| `v2.principal.get_principal_affiliate_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_principal_affiliate_performance?module=139&type=1) |
| `v2.principal.get_content_affiliate_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_content_affiliate_performance?module=139&type=1) |
| `v2.principal.get_shop_livestream_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_shop_livestream_performance?module=139&type=1) |
| `v2.principal.get_principal_livestream_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_principal_livestream_performance?module=139&type=1) |
| `v2.principal.get_session_livestream_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_session_livestream_performance?module=139&type=1) |
| `v2.principal.get_shop_video_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_shop_video_performance?module=139&type=1) |
| `v2.principal.get_principal_video_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_principal_video_performance?module=139&type=1) |
| `v2.principal.get_clip_video_performance` | [页面](https://open.shopee.cn/documents/v2/v2.principal.get_clip_video_performance?module=139&type=1) |
