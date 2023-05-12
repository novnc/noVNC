#! /bin/bash

## Google translate po generator ##
# This helper requires trans to be installed on the system running it
# This will take the template values (noVNC.pot) and append in any google translations that are missing

# Language mapping to loop through
# First column file name, second code to use for trans
IFS=$'\n'
LANGS="af af
af_ZA af
am am
am_ET am
ar_AE ar
ar ar
ar_BH ar
ar_DZ ar
ar_EG ar
ar_IN ar
ar_IQ ar
ar_JO ar
ar_KW ar
ar_LB ar
ar_LY ar
ar_MA ar
ar_OM ar
ar_QA ar
ar_SA ar
ar_SD ar
ar_SY ar
ar_TN ar
ar_YE ar
az az
az_AZ az
be be
be_BY be
bg bg
bg_BG bg
bn_BD bn
bn bn
bn_IN bn
bs_BA bs
bs bs
ca_AD ca
ca ca
ca_ES ca
ca_FR ca
ca_IT ca
cs cs
cs_CZ cs
cy cy
cy_GB cy
da da
da_DK da
de_AT de
de_BE de
de_CH de
de de
de_DE de
de_LU de
es_AR es
es_BO es
es_CL es
es_CO es
es_CR es
es_CU es
es_DO es
es_EC es
es es
es_ES es
es_GT es
es_HN es
es_MX es
es_NI es
es_PA es
es_PE es
es_PR es
es_PY es
es_SV es
es_US es
es_UY es
es_VE es
et_EE et
et et
eu_ES eu
eu eu
fa fa
fa_IR fa
fi fi
fi_FI fi
fr_BE fr
fr_CA fr
fr_CH fr
fr fr
fr_FR fr
fr_LU fr
fy_DE fy
fy fy
fy_NL fy
ga ga
ga_IE ga
gd_GB gd
gd gd
gl_ES gl
gl gl
gl gl_ES
gu gu
gu_IN gu
ha ha
ha_NG ha
he he
he_IL he
hi hi
hi_IN hi
hr hr
hr_HR hr
ht ht
ht_HT ht
hu hu
hu_HU hu
hy_AM hy
hy hy
id id
id_ID id
ig ig
ig_NG ig
is is
is_IS is
it_CH it
it it
it_IT it
ja ja
ja_JP ja
ka_GE ka
ka ka
kk kk
kk_KZ kk
km_KH km
km km
kn_IN kn
kn kn
ko ko
ko_KR ko
ku ku
ku_TR ku
ky_KG ky
ky ky
lb lb
lb_LU lb
lo_LA lo
lo lo
lt lt
lt_LT lt
lv lv
lv_LV lv
mg mg
mg_MG mg
mi mi
mi_NZ mi
mk mk
mk_MK mk
ml_IN ml
ml ml
mn mn
mn_MN mn
mr_IN mr
mr mr
ms ms
ms_MY ms
mt mt
mt_MT mt
my_MM my
my my
ne ne
ne_NP ne
nl_AW nl
nl_BE nl
nl nl
nl_NL nl
pa_IN pa
pa pa
pa_PK pa
pl pl
pl_PL pl
ps_AF ps
ps ps
pt_BR pt
pt pt
pt_PT pt
ro ro
ro_RO ro
ru ru
ru_RU ru
ru_UA ru
sd_IN sd
sd sd
si_LK si
si si
sk sk
sk_SK sk
sl_SI sl
sl sl
so_DJ so
so_ET so
so_KE so
so so
so_SO so
sq_AL sq
sq_MK sq
sq sq
st st
st_ZA st
sv_FI sv
sv_SE sv
sv sv
sw_KE sw
sw sw
ta_IN ta
ta_LK ta
ta ta
te_IN te
te te
tg tg
tg_TJ tg
th th
th_TH th
tl_PH tl
tl tl
tr_CY tr
tr tr
tr_TR tr
tt_RU tt
tt tt
uk_UA uk
uk uk
ur_IN ur
ur_PK ur
ur ur
uz uz
uz_UZ uz
vi vi
vi_VN vi
xh xh
xh_ZA xh
yi_US yi
yi yi
yo_NG yo
yo yo
zh_CN zh-CN
zh_TW zh-TW
zu_ZA zu
zu zu"

# Get translation strings from template
INPUTS=$(cat noVNC.pot | awk '/msgid "**"/' | sed 1d)

for LINKING in $LANGS; do
  FILE=$(echo "${LINKING}"| awk '{print $1}').po
  LANG=$(echo "${LINKING}"| awk '{print $2}')

  # Create file if it does not exist
  touch $FILE

  # Loop through translations
  for INPUT in $INPUTS; do
    # Only translate if it does not exists
    if ! grep -q "${INPUT}" $FILE; then
      TRANSLATED=$(trans -b :${LANG} ${INPUT//msgid /})
      # Append to existing file
      echo "" >> $FILE
      echo "${INPUT}" >> $FILE
      echo "msgstr ${TRANSLATED}" >> $FILE
    fi
  done

  ## Cleanup translation syntax
  # Foreign quotes  》
  sed -i '/^msgstr / s/„//g' $FILE
  sed -i '/^msgstr / s/“//g' $FILE
  sed -i '/^msgstr / s/”//g' $FILE
  sed -i '/^msgstr / s/«//g' $FILE
  sed -i '/^msgstr / s/»//g' $FILE
  sed -i '/^msgstr / s/》//g' $FILE
  sed -i '/^msgstr / s/《//g' $FILE
  # Quotation issues
  sed -i '/^msgstr / s/"://g' $FILE
  sed -i '/^msgstr / s/"\.//g' $FILE
  # Left indentation
  sed -i '/^msgstr / s/    */ /g' $FILE
  # Unk Characters
  sed -i '/^msgstr / s/<feff>//g' $FILE
  # Re-wrap quotes if stripped
  sed -i '/^msgstr "/! s/msgstr /msgstr "/' $FILE
  sed -i '/"$/! s/msgstr.*/&"/' $FILE
  
  # Generate json
  node po2js ${FILE} ../app/locale/${FILE::-3}.json
  sed -i '/^msgstr / s/<feff>//g' ../app/locale/${FILE::-3}.json
done
