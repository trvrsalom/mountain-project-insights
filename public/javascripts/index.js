$(document).ready(function() {
  $('form').submit(function() {
    $(".text-center").hide();
    $(".loaderdisp").show();
  });

  $('a').click(function() {
    $(".text-center").hide();
    $(".loaderdisp").show();
  });
});
