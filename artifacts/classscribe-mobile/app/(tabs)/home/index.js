import React, { useCallback, useState } from 'react';
import { Image, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Alert } from '../../../lib/notify';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../../../lib/store';
import { useBillingStatus } from '../../../lib/billing';
import { getUid } from '../../../lib/api';
import { isConfirmedDeadlineAlert } from '../../../lib/due-dates';
import { C, courseColor } from '../../../lib/theme';
import { classesOn, fmtRange, nextMeetingIn, nextMeetingLabel, WEEK_LONG } from '../../../lib/schedule';
import { daysUntil, fmtD, fmtLong, plural, todayISO, relDue, curSemester } from '../../../lib/util';
import { showActions } from '../../../components/ActionSheet';
import { ProfileAvatar } from '../../../components/ProfileAvatar';
import { useProfilePhoto } from '../../../lib/profile-photo';
import { useCreditsStatus } from '../../../lib/credits-status';

const LAYOUTS = [
  ['class-first', 'Class-first (default)'],
  ['study-first', 'Study-first'],
  ['simple', 'Simple'],
];

function Action({ label, icon, onPress, colors, style, iconColor, accessibilityLabel }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, opacity: pressed ? 0.72 : 1 }, style]}>
      {icon ? <Ionicons name={icon} size={18} color={iconColor || colors.ink} /> : null}
      <Text style={{ fontSize: 14, fontWeight: '700', color: iconColor || colors.ink }}>{label}</Text>
    </Pressable>
  );
}

function Heading({ title, caption, colors, action, onAction }) {
  return <View style={{ marginTop: 27, marginBottom: 11, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 }}>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '750', letterSpacing: -0.5 }}>{title}</Text>
      {caption ? <Text style={{ color: colors.sec, fontSize: 13 }} numberOfLines={1}>{caption}</Text> : null}
    </View>
    {action ? <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={action} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', marginVertical: -13 }}>
      <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>{action}</Text>
    </Pressable> : null}
  </View>;
}

function TodayCard({ today, mins, lectures, colors, anyTimes }) {
  const nextIndex = today.findIndex((x) => x.start > mins);
  return <View style={{ backgroundColor: colors.cell, borderRadius: 19, overflow: 'hidden', borderWidth: 1, borderColor: colors.sep }}>
    {today.length ? today.map((x, i) => {
      const recorded = lectures.some((l) => l.courseId === x.c.id && l.date === todayISO());
      const now = mins >= x.start - 15 && mins <= x.end;
      const past = x.end < mins;
      const status = recorded ? 'RECORDED' : now ? 'NOW' : past ? 'PAST' : i === nextIndex ? 'NEXT' : 'LATER';
      return <View key={`${x.c.id}-${i}`} style={{ paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', minHeight: 72, gap: 12, borderBottomWidth: i === today.length - 1 ? 0 : 1, borderBottomColor: colors.sep }}>
        <View style={{ width: 3, height: 40, borderRadius: 2, backgroundColor: courseColor(x.c), opacity: past && !recorded ? 0.35 : 1 }} />
        <View style={{ flex: 1, paddingVertical: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{x.c.code}</Text>
            <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 0.65, color: recorded ? colors.accent : now ? colors.rec : colors.sec }}>{status}</Text>
          </View>
          <Text style={{ color: colors.sec, fontSize: 12, marginTop: 4 }} numberOfLines={1}>{fmtRange(x.m.start, x.m.end)}{x.m.location ? ` · ${x.m.location}` : ''}</Text>
        </View>
        {!past && !recorded && !x.c.ex ? <Pressable onPress={() => router.push({ pathname: '/record', params: { courseId: x.c.id } })} accessibilityRole="button" accessibilityLabel={`Record ${x.c.code}`} style={{ minWidth: 75, minHeight: 44, borderRadius: 11, backgroundColor: now ? C.rec : colors.soft, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 9 }}>
          <Ionicons name="mic" size={15} color={now ? C.accentText : colors.accent} /><Text style={{ color: now ? C.accentText : colors.accent, fontWeight: '700', fontSize: 12 }}>Record</Text>
        </Pressable> : <Pressable onPress={() => router.push(`/course/${x.c.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${x.c.code}`} style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}><Ionicons name="chevron-forward" size={17} color={colors.sec} /></Pressable>}
      </View>;
    }) : <Pressable onPress={anyTimes ? () => router.push('/schedule') : () => router.push('/schedule-import')} accessibilityRole="button" accessibilityLabel={anyTimes ? 'Open schedule' : 'Import class schedule'} style={{ minHeight: 94, padding: 17, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Ionicons name={anyTimes ? 'sunny-outline' : 'calendar-outline'} size={23} color={colors.accent} />
      <View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{anyTimes ? 'No classes today' : 'Add your class times'}</Text><Text style={{ color: colors.sec, fontSize: 12, lineHeight: 18, marginTop: 3 }}>{anyTimes ? 'Take a look at the week ahead.' : 'Scan or upload your schedule to see your day in order.'}</Text></View>
      <Ionicons name="chevron-forward" size={17} color={colors.sec} />
    </Pressable>}
  </View>;
}

function CourseGrid({ courses, st, colors, compact = false }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
    {courses.map((c) => <Pressable key={c.id} onPress={() => router.push(`/course/${c.id}`)} accessibilityRole="button" accessibilityLabel={`Open ${c.code}, ${c.name}`}
      style={({ pressed }) => ({ width: '48.5%', flexGrow: 1, minHeight: compact ? 110 : 122, padding: 14, backgroundColor: colors.cell, borderRadius: 17, borderWidth: 1, borderColor: colors.sep, opacity: pressed ? 0.7 : 1, justifyContent: 'space-between' })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: courseColor(c) }} />
        <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '750', flex: 1 }} numberOfLines={1}>{c.code}</Text>
        {c.ex ? <Text style={{ color: colors.sec, fontSize: 10 }}>EXAMPLE</Text> : null}
      </View>
      <Text style={{ color: colors.sec, fontSize: 12, marginTop: 5 }} numberOfLines={1}>{c.name}</Text>
      <Text style={{ color: colors.accent, fontSize: 11, fontWeight: '600', marginTop: 9 }} numberOfLines={1}>{nextMeetingLabel(c) || 'No class time'} · {plural(st.lecturesOf(c.id).length, 'lecture')}</Text>
    </Pressable>)}
    <Pressable onPress={() => router.push('/course-new')} accessibilityRole="button" accessibilityLabel="Add course" style={({ pressed }) => ({ width: '48.5%', flexGrow: 1, minHeight: compact ? 110 : 122, padding: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.line, borderRadius: 17, opacity: pressed ? 0.65 : 1, alignItems: 'center', justifyContent: 'center', gap: 6 })}>
      <Ionicons name="add-circle-outline" size={24} color={colors.accent} /><Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>Add course</Text>
    </Pressable>
  </View>;
}

export default function Home() {
  const st = useStore();
  const billing = useBillingStatus(st.status.uid);
  const credits = useCreditsStatus(st.status.uid);
  const profilePhoto = useProfilePhoto(st.status.uid, st.status.server);
  useFocusEffect(useCallback(() => {
    st.retryPendingRecordingFinishes();
  }, [st.retryPendingRecordingFinishes]));
  const insets = useSafeAreaInsets();
  const colors = { bg: C.bg, cell: C.cell, ink: C.ink, sec: C.sec, sep: C.sep, soft: C.accentSoft, line: C.sep, accent: C.accent, rec: C.rec, exam: C.hiSoft, examInk: C.hiInk, examTrack: C.fill };
  const [refreshing, setRefreshing] = useState(false);
  const layout = ['class-first', 'study-first', 'simple'].includes(st.profile?.homeLayout) ? st.profile.homeLayout : 'class-first';
  const first = st.profile?.firstName || '';
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const normalizeSemester = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const activeSemester = normalizeSemester(st.profile?.term) || normalizeSemester(curSemester());
  const courses = st.courses().filter((c) => normalizeSemester(c.semester) === activeSemester).map((c) => ({ c, n: nextMeetingIn(c) })).sort((a, b) => a.n - b.n).map((x) => x.c);
  const activeCourseIds = new Set(courses.map((c) => c.id));
  const today = classesOn(courses, now);
  const anyTimes = courses.some((c) => (c.meetings || []).length);
  const hero = today.find((x) => mins >= x.start - 15 && mins <= x.end) || today.find((x) => x.start > mins) || null;
  const nextScheduledCourse = courses.find((c) => Number.isFinite(nextMeetingIn(c))) || null;
  const heroCourse = hero?.c || nextScheduledCourse;
  const canAlert = ['student', 'pro'].includes(billing.status?.plan) && ['active', 'trialing'].includes(billing.status?.status);
  const canSeeGrades = st.status.uid === getUid() && !billing.loading && !billing.error && canAlert;
  const upcoming = Object.values(st.all('assignments')).filter((a) => activeCourseIds.has(a.courseId) && !a.done && a.due && daysUntil(a.due) >= 0);
  const deadlineAlerts = canAlert ? upcoming.filter((a) => isConfirmedDeadlineAlert(a, activeCourseIds, daysUntil)).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 3) : [];
  const exams = upcoming.filter((a) => (a.type === 'exam' || a.type === 'quiz') && daysUntil(a.due) <= 21).sort((a, b) => a.due.localeCompare(b.due));
  const due = upcoming.filter((a) => a.type !== 'exam' && a.type !== 'quiz' && daysUntil(a.due) <= 10).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  const lectures = courses.flatMap((c) => st.lecturesOf(c.id));
  const openExam = (a) => router.push({ pathname: '/exam', params: { courseId: a.courseId, examId: a.id } });
  const chooseAppearance = async (value) => {
    try { await st.setAppearanceChoice(value); }
    catch (e) { Alert.alert('Could not save Appearance', e.message || 'Your choice will be retried when this device reconnects.'); }
  };
  const openView = () => showActions({ title: 'Choose your Home view', actions: [
    ...LAYOUTS.map(([value, name]) => ({ label: `${layout === value ? '✓  ' : ''}${name}`, onPress: () => st.saveHomeLayoutChoice(value) })),
    { label: `Appearance: ${st.appearance === 'auto' ? 'Auto' : st.appearance === 'dark' ? 'Dark' : 'Light'}  ›`, onPress: () => showActions({ title: 'Appearance', actions: [['auto', 'Automatic (match my device)'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => ({ label: `${st.appearance === value ? '✓  ' : ''}${label}`, onPress: () => chooseAppearance(value) })) }) },
    { label: 'See plans', onPress: () => router.push('/plans') },
  ] });
  const refresh = async () => { setRefreshing(true); try { await st.refresh(); } finally { setRefreshing(false); } };
  const quick = [
    { label: 'Record', icon: 'mic-outline', path: '/record', color: colors.rec },
    { label: 'Schedule', icon: 'calendar-outline', path: '/schedule', color: colors.accent },
    { label: 'Exam Center', icon: 'school-outline', path: '/exam', color: colors.accent },
    { label: 'Notes', icon: 'document-text-outline', path: '/notes', color: colors.accent },
  ];

  const todayBlock = <><Heading title="Today" caption={WEEK_LONG[now.getDay()]} action="Full schedule" onAction={() => router.push('/schedule')} colors={colors} /><TodayCard today={today} mins={mins} lectures={lectures} colors={colors} anyTimes={anyTimes} /></>;
  const courseBlock = <><Heading title="Courses" caption={`${courses.length}`} action="All courses" onAction={() => router.push('/courses')} colors={colors} /><CourseGrid courses={courses} st={st} colors={colors} compact={layout !== 'class-first'} />{!courses.length && !st.showEx ? <Action label="Show example courses" icon="eye-outline" colors={colors} onPress={() => st.setShowEx(true)} style={{ alignSelf: 'flex-start', paddingHorizontal: 12, marginTop: 8, backgroundColor: colors.soft }} iconColor={colors.accent} /> : null}</>;
   const dueBlock = due.length ? <><Heading title="Due soon" colors={colors} /><View style={{ backgroundColor: colors.cell, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: colors.sep }}>{due.map((a, i) => <View key={a.id} style={{ minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderBottomWidth: i === due.length - 1 ? 0 : 1, borderBottomColor: colors.sep }}>
    <Pressable onPress={() => st.put('assignments', { ...a, done: true })} accessibilityRole="button" accessibilityLabel={`Mark ${a.title} done`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="ellipse-outline" size={24} color={colors.accent} /></Pressable>
    <View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>{a.title}</Text><Text style={{ color: colors.sec, fontSize: 12, marginTop: 3 }}>{st.course(a.courseId)?.code || 'Course'} · {fmtD(a.due)} · {relDue(a.due)}</Text></View>
  </View>)}</View></> : null;
  const alertBlock = deadlineAlerts.length ? <><Heading title="Deadline alerts" caption="Dates you confirmed" colors={colors} /><View style={{ backgroundColor: colors.accentSoft, borderRadius: 18, overflow: 'hidden' }}>{deadlineAlerts.map((a, i) => <Pressable key={a.id} onPress={() => router.push(`/course/${a.courseId}`)} accessibilityRole="button" accessibilityLabel={`${a.title}, ${relDue(a.due)}. Open course`} style={{ minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, borderBottomWidth: i === deadlineAlerts.length - 1 ? 0 : 1, borderColor: colors.sep }}>
    <Ionicons name="notifications-outline" size={20} color={colors.accent} /><View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }} numberOfLines={1}>{a.title}</Text><Text style={{ color: colors.sec, fontSize: 12, marginTop: 3 }}>{st.course(a.courseId)?.code || 'Course'} · {fmtD(a.due)} · {relDue(a.due)}</Text></View><Ionicons name="chevron-forward" size={16} color={colors.accent} />
  </Pressable>)}</View></> : null;
  const examChips = exams.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 15 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>{exams.map((a) => <Pressable key={a.id} onPress={() => openExam(a)} accessibilityRole="button" accessibilityLabel={`${a.title}, ${daysUntil(a.due) === 0 ? 'Today' : `${daysUntil(a.due)} days away`}`} style={{ minHeight: 44, borderRadius: 13, backgroundColor: colors.exam, paddingHorizontal: 13, justifyContent: 'center', flexDirection: 'row', gap: 8, alignItems: 'center' }}><Ionicons name="time-outline" size={15} color={colors.examInk} /><Text style={{ color: colors.examInk, fontSize: 12, fontWeight: '700' }}>{st.course(a.courseId)?.code || ''} {a.title} · {daysUntil(a.due) === 0 ? 'Today' : `${daysUntil(a.due)}d`}</Text></Pressable>)}</ScrollView> : null;

  return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingLeft: Math.max(insets.left, 18), paddingRight: Math.max(insets.right, 18), paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 67 : 0) + 8, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 0) + 95 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />}>
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 9 }}>
      <Image source={require('../../../assets/classscribe/icon.png')} style={{ width: 28, height: 28, borderRadius: 7 }} accessibilityLabel="ClassScribe" />
      <Text testID="home-brand-name" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={{ color: colors.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.7, flex: 1 }}>ClassScribe</Text>
      <Pressable onPress={() => router.push('/support')} accessibilityRole="button" accessibilityLabel="Help" hitSlop={4} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="help-circle-outline" size={25} color={colors.accent} />
      </Pressable>
      <Pressable onPress={() => router.push('/account')} accessibilityRole="button" accessibilityLabel="Account" testID="home-profile-avatar" style={{ minWidth: 44, minHeight: 44, borderRadius: 22, backgroundColor: colors.soft, alignItems: 'center', justifyContent: 'center' }}>
        <ProfileAvatar key={st.status.uid || 'none'} source={profilePhoto.source} initial={first[0]} />
      </Pressable>
    </View>
    <View testID="home-header-tools" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 9, marginTop: 8 }}>
      <Pressable onPress={openView} accessibilityRole="button" accessibilityLabel={`View chooser, ${LAYOUTS.find(([v]) => v === layout)?.[1]} selected`} style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.cell, borderWidth: 1, borderColor: colors.sep }}>
        <Ionicons name="grid-outline" size={15} color={colors.accent} /><Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>View</Text><Ionicons name="chevron-down" size={12} color={colors.sec} />
      </Pressable>
       <Pressable onPress={() => router.push('/credits')} accessibilityRole="button" accessibilityLabel={`Credits balance${credits.status ? `, ${credits.status.balance} ${credits.status.currency.name}` : ''}`} style={{ minHeight: 44, paddingHorizontal: 10, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.cell, borderWidth: 1, borderColor: colors.sep }}>
         <View style={{ width: 23, height: 23, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="pulse" size={16} color={C.accentText} /></View>
         <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '800' }}>{credits.status?.balance ?? 'Credits'}</Text>
       </Pressable>
    </View>
    <View style={{ marginTop: 20, marginBottom: 17 }}><Text style={{ color: colors.sec, fontSize: 13, fontWeight: '600' }}>{fmtLong(todayISO())}</Text><Text style={{ color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '750', letterSpacing: -0.9, marginTop: 3 }}>{`${now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'}${first ? `, ${first}` : ''}.`}</Text></View>
    {canSeeGrades ? <Pressable onPress={() => router.push('/grades')} accessibilityRole="button" accessibilityLabel="Open grades and estimated GPA" style={{ flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: colors.cell, borderWidth: 1, borderColor: colors.sep, borderRadius: 16, paddingHorizontal: 16, minHeight: 66, marginBottom: 15 }}>
      <Ionicons name="stats-chart-outline" size={22} color={colors.accent} />
      <View style={{ flex: 1 }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '800' }}>Grades & estimated GPA</Text><Text style={{ color: colors.sec, fontSize: 12, marginTop: 2 }}>Your progress, course by course</Text></View>
      <Ionicons name="chevron-forward" size={17} color={colors.sec} />
    </Pressable> : null}

    {!st.status.server ? <View style={{ backgroundColor: colors.cell, padding: 15, borderRadius: 15, marginBottom: 15, borderWidth: 1, borderColor: colors.sep }}><Text style={{ color: colors.ink, fontSize: 13, lineHeight: 19 }}>Connect to your ClassScribe server to sync, use AI and join class groups.</Text><Action label="Add server address" icon="arrow-forward" colors={colors} iconColor={colors.accent} onPress={() => router.push('/account')} style={{ alignSelf: 'flex-start' }} /></View> : !st.status.online && !st.status.loading ? <View style={{ backgroundColor: colors.cell, padding: 14, borderRadius: 15, marginBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Ionicons name="cloud-offline-outline" size={18} color={colors.sec} /><Text style={{ color: colors.sec, fontSize: 12, flex: 1 }}>Offline. Changes save on this phone and sync when you’re back online.</Text></View> : null}

    {layout === 'class-first' ? <>
        <View style={{ backgroundColor: C.hero, borderRadius: 21, padding: 19, minHeight: 151, justifyContent: 'space-between' }}>
        <View><Text style={{ color: C.heroText, opacity: 0.78, fontSize: 11, fontWeight: '800', letterSpacing: 1.3 }}>{hero ? (mins >= hero.start - 15 && mins <= hero.end ? 'IN CLASS NOW' : 'UP NEXT') : heroCourse ? 'YOUR NEXT CLASS' : 'MAKE TODAY YOURS'}</Text>
          <Text style={{ color: C.heroText, fontWeight: '800', fontSize: 22, letterSpacing: -0.6, marginTop: 7 }} numberOfLines={1}>{heroCourse ? `${heroCourse.code} · ${heroCourse.name}` : 'Add your class times'}</Text>
          <Text style={{ color: C.heroText, opacity: 0.88, fontSize: 12, marginTop: 4 }} numberOfLines={1}>{hero ? `${fmtRange(hero.m.start, hero.m.end)}${hero.m.location ? ` · ${hero.m.location}` : ''}` : heroCourse ? nextMeetingLabel(heroCourse) : 'Scan or upload your schedule to see what’s next.'}</Text>
        </View>
         <Pressable onPress={() => heroCourse ? router.push(heroCourse.ex ? `/course/${heroCourse.id}` : { pathname: '/record', params: { courseId: heroCourse.id } }) : router.push('/schedule-import')} accessibilityRole="button" accessibilityLabel={heroCourse ? (heroCourse.ex ? `Open ${heroCourse.code}` : `Record ${heroCourse.code}`) : 'Scan schedule'} style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, borderRadius: 12, backgroundColor: C.cell, marginTop: 15 }}>
           <Ionicons name={heroCourse ? heroCourse.ex ? 'book-outline' : 'mic' : 'scan-outline'} size={17} color={heroCourse && !heroCourse.ex ? C.rec : C.accent} /><Text style={{ color: C.accent, fontSize: 13, fontWeight: '800' }}>{heroCourse ? heroCourse.ex ? 'Open example' : 'Record' : 'Scan schedule'}</Text>
        </Pressable>
      </View>
      {examChips}{todayBlock}
      <Heading title="Quick actions" colors={colors} /><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>{quick.map((q) => <Pressable key={q.label} onPress={() => router.push(q.path)} accessibilityRole="button" accessibilityLabel={q.label} style={({ pressed }) => ({ width: '23%', flexGrow: 1, minHeight: 83, borderRadius: 15, backgroundColor: colors.cell, borderWidth: 1, borderColor: colors.sep, alignItems: 'center', justifyContent: 'center', gap: 7, opacity: pressed ? 0.7 : 1 })}><Ionicons name={q.icon} size={22} color={q.color} /><Text style={{ color: colors.ink, fontWeight: '700', fontSize: 11 }}>{q.label}</Text></Pressable>)}</View>
       {alertBlock}{courseBlock}{dueBlock}
    </> : layout === 'study-first' ? <>
      <Heading title="Coming up" caption="Next 21 days" colors={colors} action="Exam Center" onAction={() => router.push('/exam')} />
      {exams.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>{exams.map((a) => {
        const relevant = st.lecturesOf(a.courseId).filter((l) => l.date <= a.due);
        const done = relevant.filter((l) => l.reviewed).length;
        return <Pressable key={a.id} onPress={() => openExam(a)} accessibilityRole="button" accessibilityLabel={`Study ${a.title}, ${daysUntil(a.due)} days away`} style={{ width: '48.5%', flexGrow: 1, minHeight: 155, borderRadius: 18, backgroundColor: colors.exam, padding: 14, justifyContent: 'space-between' }}>
          <Text style={{ color: colors.examInk, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 }}>{st.course(a.courseId)?.code || 'EXAM'}</Text>
          <View><Text style={{ color: colors.ink, fontWeight: '750', fontSize: 15 }} numberOfLines={2}>{a.title}</Text><Text style={{ color: colors.examInk, fontSize: 12, marginTop: 4 }}>{daysUntil(a.due) === 0 ? 'Today' : `${daysUntil(a.due)} days left`}</Text></View>
          <View><View style={{ height: 4, borderRadius: 2, backgroundColor: colors.examTrack, overflow: 'hidden' }}><View style={{ height: 4, width: `${relevant.length ? done / relevant.length * 100 : 0}%`, backgroundColor: C.accent }} /></View><Text style={{ color: colors.examInk, fontSize: 10, marginTop: 5 }}>{relevant.length ? `${done} of ${relevant.length} lectures reviewed` : 'No lectures to review yet'}</Text></View>
        </Pressable>;
      })}</View> : <View style={{ minHeight: 105, padding: 18, backgroundColor: colors.cell, borderRadius: 18, justifyContent: 'center' }}><Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>No exams in the next 21 days</Text><Text style={{ color: colors.sec, fontSize: 12, marginTop: 5 }}>Your upcoming study milestones will appear here.</Text></View>}
      <Action label="Continue studying" icon="arrow-forward" colors={colors} iconColor={C.accentText} onPress={() => exams.length ? openExam(exams[0]) : router.push('/exam')} style={{ backgroundColor: C.accent, marginTop: 12 }} />
       {alertBlock}{todayBlock}{dueBlock}{courseBlock}
    </> : <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 3 }}>{[
        ['Record', 'mic-outline', '/record', colors.rec], ['Today', 'calendar-outline', '/schedule', colors.accent],
        ['Schedule', 'calendar-number-outline', '/schedule', colors.accent], ['Exam Center', 'school-outline', '/exam', colors.accent],
          ['Notes', 'document-text-outline', '/notes', colors.accent],
         ['Ask', 'chatbubble-ellipses-outline', '/ask', colors.accent],
      ].map(([name, icon, path, color]) => <Pressable key={name} onPress={() => router.push(path)} accessibilityRole="button" accessibilityLabel={name} style={({ pressed }) => ({ width: '48.5%', flexGrow: 1, minHeight: 115, backgroundColor: colors.cell, borderWidth: 1, borderColor: colors.sep, borderRadius: 18, padding: 15, justifyContent: 'space-between', opacity: pressed ? 0.7 : 1 })}><Ionicons name={icon} size={27} color={color} /><Text style={{ color: colors.ink, fontSize: 17, fontWeight: '750' }}>{name}</Text></Pressable>)}</View>
       {alertBlock}{courseBlock}{examChips}{dueBlock}
    </>}
  </ScrollView>;
}