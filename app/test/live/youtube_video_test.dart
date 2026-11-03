import 'package:dialektik/features/live/data/live_news_models.dart';
import 'package:dialektik/features/live/data/youtube_video.dart';
import 'package:dialektik/features/live/presentation/live_news_screens.dart';
import 'package:dialektik/features/live/presentation/widgets/youtube_thumbnail.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'live_fixtures.dart';

void main(){
  test('extracts only valid YouTube URLs and builds official thumbnails',(){
    const id='aB3_deF-123';
    for(final url in ['https://youtube.com/watch?v=$id&x=1','https://youtu.be/$id','https://m.youtube.com/live/$id','https://www.youtube.com/shorts/$id','https://www.youtube.com/embed/$id']){
      expect(extractYouTubeVideoId(url),id);
    }
    for(final url in [null,'','https://youtube.com.evil.test/watch?v=$id','https://example.test/?v=$id','https://youtu.be/${id}x','javascript:youtube.com/watch?v=$id','https://youtube.com/watch?v=$id&v=bbbbbbbbbbb']){
      expect(extractYouTubeVideoId(url),isNull);
    }
    expect(youTubeThumbnailUrl(id),'https://i.ytimg.com/vi/$id/hqdefault.jpg');
    expect(()=>youTubeThumbnailUrl('bad'),throwsArgumentError);
  });
  testWidgets('thumbnail shows a 16:9 play target and handles image failure', (tester) async {
    var clicked=false;
    await tester.pumpWidget(MaterialApp(home:Scaffold(body:YouTubeThumbnail(videoId:'aB3_deF-123',onTap:()=>clicked=true))));
    await tester.pump();
    expect(tester.widget<AspectRatio>(find.byType(AspectRatio)).aspectRatio,16/9);
    expect(find.text('Ver en YouTube'),findsOneWidget);
    await tester.tap(find.bySemanticsLabel('Abrir video en YouTube'));
    expect(clicked,isTrue);
    await tester.pump(const Duration(seconds:1));
    expect(tester.takeException(),isNull);
  });
  testWidgets('lead and ordinary video cards open the video target', (tester) async {
    var opened=0;
    final article=LiveNewsItemDto.fromJson({...liveTestArticle(),
      'canonical_url':'https://www.youtube.com/watch?v=aB3_deF-123'});
    for (final card in <Widget>[
      LiveLeadCard(article:article,onPressed:()=>opened++),
      LiveNewsCard(article:article,onPressed:()=>opened++),
    ]) {
      await tester.pumpWidget(MaterialApp(home:Scaffold(body:card)));
      await tester.pump();
      expect(find.byType(YouTubeThumbnail),findsOneWidget);
      await tester.tap(find.text(article.headline));
      await tester.pump();
    }
    expect(opened,2);
    expect(tester.takeException(),isNull);
  });
}
