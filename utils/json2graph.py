#!/usr/bin/env python

'''
Use matplotlib to generate performance charts
Copyright 2011 Joel Martin
Licensed under MPL-2.0 (see docs/LICENSE.MPL-2.0)
'''

# a bar plot with errorbars
import sys, json, pprint
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties

def usage():
    print "%s json_file level1 level2 level3 [legend_height]\n\n" % sys.argv[0]
    print "Description:\n"
    print "level1, level2, and level3 are one each of the following:\n";
    print "  select=ITEM - select only ITEM at this level";
    print "  bar         - each item on this level becomes a graph bar";
    print "  group       - items on this level become groups of bars";
    print "\n";
    print "json_file is a file containing json data in the following format:\n"
    print '  {';
    print '    "conf": {';
    print '      "order_l1": [';
    print '        "level1_label1",';
    print '        "level1_label2",';
    print '        ...';
    print '      ],';
    print '      "order_l2": [';
    print '        "level2_label1",';
    print '        "level2_label2",';
    print '        ...';
    print '      ],';
    print '      "order_l3": [';
    print '        "level3_label1",';
    print '        "level3_label2",';
    print '        ...';
    print '      ]';
    print '    },';
    print '    "stats": {';
    print '      "level1_label1": {';
    print '        "level2_label1": {';
    print '          "level3_label1": [val1, val2, val3],';
    print '          "level3_label2": [val1, val2, val3],';
    print '          ...';
    print '        },';
    print '        "level2_label2": {';
    print '        ...';
    print '        },';
    print '      },';
    print '      "level1_label2": {';
    print '        ...';
    print '      },';
    print '      ...';
    print '    },';
    print '  }';
    sys.exit(2)

def error(msg):
    print msg
    sys.exit(1)


#colors = ['#ff0000', '#0863e9', '#00f200', '#ffa100',
#          '#800000', '#805100', '#013075', '#007900']
colors = ['#ff0000', '#00ff00', '#0000ff',
          '#dddd00', '#dd00dd', '#00dddd',
          '#dd6622', '#dd2266', '#66dd22',
          '#8844dd', '#44dd88', '#4488dd']

if len(sys.argv) < 5:
    usage()

filename = sys.argv[1]
L1 = sys.argv[2]
L2 = sys.argv[3]
L3 = sys.argv[4]
if len(sys.argv) > 5:
    legendHeight = float(sys.argv[5])
else:
    legendHeight = 0.75

# Load the JSON data from the file
data = json.loads(file(filename).read())
conf = data['conf']
stats = data['stats']

# Sanity check data hierarchy
if len(conf['order_l1']) != len(stats.keys()):
    error("conf.order_l1 does not match stats level 1")
for l1 in stats.keys():
    if len(conf['order_l2']) != len(stats[l1].keys()):
        error("conf.order_l2 does not match stats level 2 for %s" % l1)
    if conf['order_l1'].count(l1) < 1:
        error("%s not found in conf.order_l1" % l1)
    for l2 in stats[l1].keys():
        if len(conf['order_l3']) != len(stats[l1][l2].keys()):
            error("conf.order_l3 does not match stats level 3")
        if conf['order_l2'].count(l2) < 1:
            error("%s not found in conf.order_l2" % l2)
        for l3 in stats[l1][l2].keys():
            if conf['order_l3'].count(l3) < 1:
                error("%s not found in conf.order_l3" % l3)

#
# Generate the data based on the level specifications
#
bar_labels = None
group_labels = None
bar_vals = []
bar_sdvs = []
if L3.startswith("select="):
    select_label = l3 = L3.split("=")[1]
    bar_labels = conf['order_l1']
    group_labels = conf['order_l2']
    bar_vals = [[0]*len(group_labels) for i in bar_labels]
    bar_sdvs = [[0]*len(group_labels) for i in bar_labels]
    for b in range(len(bar_labels)):
        l1 = bar_labels[b]
        for g in range(len(group_labels)):
            l2 = group_labels[g]
            bar_vals[b][g] = np.mean(stats[l1][l2][l3])
            bar_sdvs[b][g] = np.std(stats[l1][l2][l3])
elif L2.startswith("select="):
    select_label = l2 = L2.split("=")[1]
    bar_labels = conf['order_l1']
    group_labels = conf['order_l3']
    bar_vals = [[0]*len(group_labels) for i in bar_labels]
    bar_sdvs = [[0]*len(group_labels) for i in bar_labels]
    for b in range(len(bar_labels)):
        l1 = bar_labels[b]
        for g in range(len(group_labels)):
            l3 = group_labels[g]
            bar_vals[b][g] = np.mean(stats[l1][l2][l3])
            bar_sdvs[b][g] = np.std(stats[l1][l2][l3])
elif L1.startswith("select="):
    select_label = l1 = L1.split("=")[1]
    bar_labels = conf['order_l2']
    group_labels = conf['order_l3']
    bar_vals = [[0]*len(group_labels) for i in bar_labels]
    bar_sdvs = [[0]*len(group_labels) for i in bar_labels]
    for b in range(len(bar_labels)):
        l2 = bar_labels[b]
        for g in range(len(group_labels)):
            l3 = group_labels[g]
            bar_vals[b][g] = np.mean(stats[l1][l2][l3])
            bar_sdvs[b][g] = np.std(stats[l1][l2][l3])
else:
    usage()

# If group is before bar then flip (zip) the data
if [L1, L2, L3].index("group") < [L1, L2, L3].index("bar"):
    bar_labels, group_labels = group_labels, bar_labels
    bar_vals = zip(*bar_vals)
    bar_sdvs = zip(*bar_sdvs)

print "bar_vals:", bar_vals

#
# Now render the bar graph
#
ind = np.arange(len(group_labels))  # the x locations for the groups
width = 0.8 * (1.0/len(bar_labels)) # the width of the bars

fig = plt.figure(figsize=(10,6), dpi=80)
plot = fig.add_subplot(1, 1, 1)

rects = []
for i in range(len(bar_vals)):
    rects.append(plot.bar(ind+width*i, bar_vals[i], width, color=colors[i],
                          yerr=bar_sdvs[i], align='center'))

# add some
plot.set_ylabel('Milliseconds (less is better)')
plot.set_title("Javascript array test: %s" % select_label)
plot.set_xticks(ind+width)
plot.set_xticklabels( group_labels )

fontP = FontProperties()
fontP.set_size('small')
plot.legend( [r[0] for r in rects], bar_labels, prop=fontP,
            loc = 'center right', bbox_to_anchor = (1.0, legendHeight))

def autolabel(rects):
    # attach some text labels
    for rect in rects:
        height = rect.get_height()
        if np.isnan(height):
            height = 0.0
        plot.text(rect.get_x()+rect.get_width()/2., height+20, '%d'%int(height),
                ha='center', va='bottom', size='7')

for rect in rects:
    autolabel(rect)

# Adjust axis sizes
axis = list(plot.axis())
axis[0] = -width          # Make sure left side has enough for bar
#axis[1] = axis[1] * 1.20  # Add 20% to the right to make sure it fits
axis[2] = 0               # Make y-axis start at 0
axis[3] = axis[3] * 1.10  # Add 10% to the top
plot.axis(axis)

plt.show()
